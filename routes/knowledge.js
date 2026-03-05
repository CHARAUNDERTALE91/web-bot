const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const ownerAuth = require('../middleware/ownerAuth');
const { strictLimiter } = require('../middleware/rateLimiter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ✅ PUBLIC — Baca semua knowledge
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    let query = supabase
      .from('knowledge')
      .select('*')
      .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ 
      total: data.length,
      data 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PUBLIC — Cari knowledge
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required!' });

    const { data, error } = await supabase
      .from('knowledge')
      .select('*')
      .or(`title.ilike.%${q}%,content.ilike.%${q}%`);

    if (error) throw error;
    res.json({ total: data.length, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 👑 OWNER ONLY — Tambah knowledge
router.post('/', ownerAuth, strictLimiter, async (req, res) => {
  try {
    const { title, content, category } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title & content required!' });
    }

    const { data, error } = await supabase
      .from('knowledge')
      .insert([{ title, content, category: category || 'general' }])
      .select();

    if (error) throw error;
    res.status(201).json({ 
      message: '✅ Knowledge added!', 
      data: data[0] 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 👑 OWNER ONLY — Edit knowledge
router.put('/:id', ownerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    const { data, error } = await supabase
      .from('knowledge')
      .update({ 
        title, content, category,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: 'Not found!' });

    res.json({ message: '✅ Knowledge updated!', data: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 👑 OWNER ONLY — Hapus knowledge
router.delete('/:id', ownerAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('knowledge')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: '🗑️ Knowledge deleted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
