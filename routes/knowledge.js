/**
 * /knowledge route — READ ONLY from web
 * Write operations are CLI-only (cli/know.js)
 */
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// GET /knowledge — list all (for status bar count)
router.get('/', async (req, res) => {
  try {
    const category = req.query.category;
    const limit    = Math.min(parseInt(req.query.limit) || 500, 1000);

    let query = supabase
      .from('knowledge')
      .select('id, title, category, tags, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /knowledge/stats
router.get('/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('knowledge')
      .select('id, category, file_type, content');
    if (error) throw error;

    const cats  = {};
    const types = {};
    let totalChars = 0;
    data.forEach(k => {
      cats[k.category]  = (cats[k.category]  || 0) + 1;
      if (k.file_type) types[k.file_type] = (types[k.file_type] || 0) + 1;
      totalChars += (k.content || '').length;
    });

    res.json({
      total: data.length,
      totalChars,
      categories: cats,
      fileTypes: types,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /knowledge/search?q=
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ data: [] });

    const { data, error } = await supabase
      .from('knowledge')
      .select('id, title, category, tags, created_at')
      .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ data, query: q });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All write routes disabled for web — use CLI
router.post('/',   (req, res) => res.status(403).json({ error: 'Use Termux CLI to add knowledge: node cli/know.js add' }));
router.put('/:id', (req, res) => res.status(403).json({ error: 'Use Termux CLI to edit: node cli/know.js edit <id>' }));
router.delete('/:id', (req, res) => res.status(403).json({ error: 'Use Termux CLI to delete: node cli/know.js delete <id>' }));

module.exports = router;
