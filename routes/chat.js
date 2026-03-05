const express = require('express');
const router  = require('express').Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const OR_BASE = 'https://api.z.ai/v1';

// z.ai GLM models
const MODELS = {
  'glm-z1-flash':  { max: 131072, name: 'GLM Z1 Flash' },
  'glm-4-flash':   { max: 131072, name: 'GLM-4 Flash'  },
  'glm-4-flashx':  { max: 131072, name: 'GLM-4 FlashX' },
  'glm-4':         { max: 131072, name: 'GLM-4'        },
};

const DEFAULT_MODEL = 'glm-z1-flash';

// Fetch dengan timeout
async function fetchWithTimeout(url, options, ms = 25000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(tid);
    return res;
  } catch(e) {
    clearTimeout(tid);
    throw e.name === 'AbortError' ? new Error('Request timeout (25s). Coba lagi.') : e;
  }
}

async function buildSystem(customPersona) {
  const { data: knowledge } = await supabase
    .from('knowledge')
    .select('title, content, category, tags')
    .order('created_at', { ascending: false });

  const kb = knowledge && knowledge.length > 0
    ? knowledge.map(k => `[${k.category}] ${k.title}:\n${k.content}`).join('\n\n---\n\n')
    : 'No knowledge stored yet.';

  const base = customPersona || [
    'You are a highly capable personal AI assistant.',
    'Be direct, accurate, and genuinely helpful.',
    'Use the knowledge base below when relevant.',
    'Format responses with markdown when it helps clarity.',
    'Match the language the user writes in.',
  ].join('\n');

  return `${base}\n\n=== PERSONAL KNOWLEDGE BASE ===\n${kb}\n=== END KNOWLEDGE BASE ===`;
}

function buildMessages(systemContent, history, message) {
  const msgs = [{ role: 'system', content: systemContent }];
  if (history?.length) {
    history.slice(-16).forEach(h => {
      if (['user','assistant'].includes(h.role)) {
        msgs.push({ role: h.role, content: String(h.content).slice(0, 8000) });
      }
    });
  }
  msgs.push({ role: 'user', content: message });
  return msgs;
}

// z.ai fetch helper
function orHeaders() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${process.env.ZAI_API_KEY}`,
  };
}

// POST /chat — standard (non-streaming)
router.post('/', async (req, res) => {
  try {
    const { message, model, persona, history, temperature } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required!' });

    const modelId = MODELS[model] ? model : DEFAULT_MODEL;
    const maxTok  = MODELS[modelId]?.max || 8192;
    const temp    = Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 1);

    const systemContent = await buildSystem(persona);
    const messages = buildMessages(systemContent, history, message);

    const resp = await fetchWithTimeout(`${OR_BASE}/chat/completions`, {
      method:  'POST',
      headers: orHeaders(),
      body: JSON.stringify({ model: modelId, messages, max_tokens: Math.min(maxTok, 2048), temperature: temp }),
    }, 25000);

    const data = await resp.json();
    console.log('[z.ai response]', JSON.stringify(data).slice(0, 500));
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    const msg = data.choices[0].message;
    // GLM kadang pakai reasoning_content atau content
    const reply = msg.content || msg.reasoning_content || msg.tool_calls?.[0]?.function?.arguments || JSON.stringify(msg);
    const usage = data.usage;

    supabase.from('sessions').insert([{
      messages_count: (history?.length || 0) + 2,
      tokens_used:    usage?.total_tokens || 0,
      model_used:     modelId,
    }]).then(() => {}).catch(() => {});

    res.json({ reply, usage, model: modelId });
  } catch (err) {
    console.error('[chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /chat/stream — SSE streaming via OpenRouter
router.post('/stream', async (req, res) => {
  try {
    const { message, model, persona, history, temperature } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required!' });

    const modelId = MODELS[model] ? model : DEFAULT_MODEL;
    const maxTok  = MODELS[modelId]?.max || 8192;
    const temp    = Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 1);

    const systemContent = await buildSystem(persona);
    const messages = buildMessages(systemContent, history, message);

    res.setHeader('Content-Type',     'text/event-stream');
    res.setHeader('Cache-Control',    'no-cache');
    res.setHeader('Connection',       'keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();

    const upstream = await fetchWithTimeout(`${OR_BASE}/chat/completions`, {
      method:  'POST',
      headers: orHeaders(),
      body: JSON.stringify({
        model: modelId, messages,
        max_tokens: Math.min(maxTok, 2048), temperature: temp,
        stream: true,
      }),
    }, 25000);

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.write('data: ' + JSON.stringify({ error: errText }) + '\n\n');
      return res.end();
    }

    const reader  = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', approxTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data:')) continue;

        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            approxTokens += delta.split(' ').length;
            res.write('data: ' + JSON.stringify({ token: delta }) + '\n\n');
          }
        } catch (_) {}
      }
    }

    res.write('data: ' + JSON.stringify({ done: true, approxTokens }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[stream]', err.message);
    try {
      res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
      res.end();
    } catch (_) {}
  }
});

// GET /chat/models — available models
router.get('/models', (req, res) => {
  res.json({ models: Object.entries(MODELS).map(([id, info]) => ({ id, ...info })) });
});

// POST /chat/rate — rate a response
router.post('/rate', async (req, res) => {
  try {
    const { rating, message_preview, session_ref } = req.body;
    if (![-1, 1].includes(rating)) return res.status(400).json({ error: 'Rating must be 1 or -1' });
    await supabase.from('ratings').insert([{ rating, message_preview: message_preview?.slice(0,200), session_ref }]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /chat/stats — server stats
router.get('/stats', async (req, res) => {
  try {
    const [{ count: totalSess }, { data: ratings }] = await Promise.all([
      supabase.from('sessions').select('*', { count: 'exact', head: true }),
      supabase.from('ratings').select('rating'),
    ]);
    const pos = ratings?.filter(r => r.rating === 1).length || 0;
    const neg = ratings?.filter(r => r.rating === -1).length || 0;
    res.json({ sessions: totalSess, ratings: { positive: pos, negative: neg } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
