const express = require('express');
const router  = express.Router();

// Simple ping/webhook endpoint
router.post('/', (req, res) => {
  const { event, data } = req.body;
  console.log('[webhook]', event, JSON.stringify(data).slice(0, 100));
  res.json({ received: true, event });
});

router.get('/ping', (req, res) => {
  res.json({ pong: true, ts: new Date().toISOString() });
});

module.exports = router;
