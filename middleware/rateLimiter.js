const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 100,                  // max 100 request per 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: '🛑 Too many requests! Slow down Bos~',
    retry_after: '15 minutes'
  }
});

// Strict limiter buat endpoint sensitif
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 10,
  message: {
    error: '🛑 Endpoint ini super limited! Max 10/menit',
  }
});

module.exports = { limiter, strictLimiter };
