const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📡 Webhook receiver
router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    const timestamp = new Date().toISOString();

    console.log(`📡 Webhook received at ${timestamp}:`, payload);

    // Bisa lo proses payload di sini
    // Contoh: auto-save ke DB, trigger action, dll

    res.json({ 
      status: '✅ Webhook received!',
      timestamp,
      payload_keys: Object.keys(payload)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
