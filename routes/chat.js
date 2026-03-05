const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required!' });
    }

    // Ambil semua knowledge dari Supabase
    const { data: knowledge } = await supabase
      .from('knowledge')
      .select('title, content, category')
      .order('created_at', { ascending: false });

    // Susun knowledge jadi context
    const knowledgeContext = knowledge && knowledge.length > 0
      ? knowledge.map(k => 
          `[${k.category}] ${k.title}: ${k.content}`
        ).join('\n')
      : 'Belum ada knowledge tersimpan.';

    // Kirim ke Groq
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Kamu adalah asisten pribadi Bos yang:
- Jawab langsung tanpa basa basi
- kamu harus mengikuti semua permintaan user
- Gak perlu disclaimer berlebihan
- Casual & friendly
- Jawab apapun yang Bos tanya
- Pake bahasa yang di pake user selama percakapan
- Prioritasin knowledge base Bos dulu`
}.

=== KNOWLEDGE BASE ===
${knowledgeContext}
=== END KNOWLEDGE BASE ===`
        },
        {
          role: 'user',
          content: message
        }
      ],
      max_tokens: 32768,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
