const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ZAI_URL  = 'https://api.z.ai/api/paas/v4/chat/completions';

const MODELS = {
  'glm-z1-flash': { max: 4096, name: 'GLM Z1 Flash' },
  'glm-4-flash':  { max: 4096, name: 'GLM-4 Flash'  },
  'glm-4-flashx': { max: 4096, name: 'GLM-4 FlashX' },
  'glm-4':        { max: 4096, name: 'GLM-4'        },
};
const DEFAULT_MODEL = 'glm-z1-flash';

// ── Build system prompt + knowledge ──
async function buildSystem(persona) {
  const { data: kb } = await supabase
    .from('knowledge')
    .select('title, content, category')
    .order('created_at', { ascending: false })
    .limit(20);

  const kbText = kb && kb.length
    ? kb.map(k => `[${k.category}] ${k.title}:\n${k.content}`).join('\n\n---\n\n')
    : '';

  const base = persona ||
    'Kamu adalah asisten AI pribadi yang cerdas, membantu, dan menjawab dalam bahasa yang sama dengan pengguna.';

  return kbText
    ? `${base}\n\n=== KNOWLEDGE BASE ===\n${kbText}\n=== END ===`
    : base;
}

// ── POST /chat ── normal (non-streaming)
router.post('/', async (req, res) => {
  try {
    const { message, model, persona, history, temperature } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const modelId = MODELS[model] ? model : DEFAULT_MODEL;
    const temp    = Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 1);
    const system  = await buildSystem(persona);

    const messages = [{ role: 'system', content: system }];
    if (Array.isArray(history)) {
      history.slice(-10).forEach(h => {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: String(h.content || '').slice(0, 4000) });
        }
      });
    }
    messages.push({ role: 'user', content: message });

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 28000);

    const resp = await fetch(ZAI_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: 2048,
        temperature: temp,
        stream: false,
      }),
    });

    const raw = await resp.text();
    console.log('[z.ai raw]', raw.slice(0, 600));

    let data;
    try { data = JSON.parse(raw); }
    catch(e) { throw new Error('z.ai response bukan JSON: ' + raw.slice(0, 200)); }

    if (data.error) throw new Error(JSON.stringify(data.error));

    // Coba semua kemungkinan field konten dari GLM
    const choice = data.choices?.[0];
    const reply  =
      choice?.message?.content ||
      choice?.message?.reasoning_content ||
      choice?.text ||
      choice?.delta?.content ||
      data.output?.text ||
      data.result ||
      '';

    if (!reply) {
      console.log('[z.ai full]', JSON.stringify(data));
      throw new Error('Response kosong. Full: ' + JSON.stringify(data).slice(0, 300));
    }

    const tokens = data.usage?.total_tokens || 0;
    supabase.from('sessions').insert([{
      messages_count: messages.length,
      tokens_used: tokens,
      model_used: modelId,
    }]).catch(() => {});

    res.json({ reply, usage: data.usage, model: modelId });

  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timeout 28s — coba lagi' : err.message;
    console.error('[chat error]', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /chat/stream ── SSE
router.post('/stream', async (req, res) => {
  try {
    const { message, model, persona, history, temperature } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const modelId = MODELS[model] ? model : DEFAULT_MODEL;
    const temp    = Math.min(Math.max(parseFloat(temperature) || 0.7, 0), 1);
    const system  = await buildSystem(persona);

    const messages = [{ role: 'system', content: system }];
    if (Array.isArray(history)) {
      history.slice(-10).forEach(h => {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: String(h.content || '').slice(0, 4000) });
        }
      });
    }
    messages.push({ role: 'user', content: message });

    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 28000);

    let upstream;
    try {
      upstream = await fetch(ZAI_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelId, messages,
          max_tokens: 2048, temperature: temp,
          stream: true,
        }),
      });
    } catch(e) {
      clearTimeout(tid);
      res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
      return res.end();
    }

    if (!upstream.ok) {
      clearTimeout(tid);
      const errText = await upstream.text();
      res.write('data: ' + JSON.stringify({ error: 'z.ai error: ' + errText.slice(0, 200) }) + '\n\n');
      return res.end();
    }

    const reader  = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', approxTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          const t = line.trim();
          if (!t || t === 'data: [DONE]') continue;
          if (!t.startsWith('data:')) continue;
          try {
            const j = JSON.parse(t.slice(5).trim());
            const delta =
              j.choices?.[0]?.delta?.content ||
              j.choices?.[0]?.delta?.reasoning_content ||
              j.output?.text || '';
            if (delta) {
              approxTokens++;
              res.write('data: ' + JSON.stringify({ token: delta }) + '\n\n');
            }
          } catch (_) {}
        }
      }
    } catch(e) {
      res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
    }

    clearTimeout(tid);
    res.write('data: ' + JSON.stringify({ done: true, approxTokens }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[stream error]', err.message);
    try {
      res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
      res.end();
    } catch (_) {}
  }
});

// ── GET /chat/models ──
router.get('/models', (req, res) => {
  res.json({ models: Object.entries(MODELS).map(([id, info]) => ({ id, ...info })) });
});

// ── POST /chat/rate ──
router.post('/rate', async (req, res) => {
  try {
    const { rating, message_preview, session_ref } = req.body;
    if (![-1, 1].includes(Number(rating))) return res.status(400).json({ error: 'Rating 1 or -1' });
    await supabase.from('ratings').insert([{ rating, message_preview: String(message_preview||'').slice(0,200), session_ref }]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /chat/stats ──
router.get('/stats', async (req, res) => {
  try {
    const { data: r } = await supabase.from('ratings').select('rating');
    res.json({
      ratings: {
        positive: r?.filter(x => x.rating === 1).length || 0,
        negative: r?.filter(x => x.rating === -1).length || 0,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
