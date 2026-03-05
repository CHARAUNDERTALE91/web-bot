const hits = {};
const WINDOW = 60 * 1000; // 1 minute
const MAX    = 60;         // 60 req/min per IP

exports.limiter = (req, res, next) => {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (!hits[ip]) hits[ip] = [];
  hits[ip] = hits[ip].filter(t => now - t < WINDOW);
  if (hits[ip].length >= MAX) {
    return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  }
  hits[ip].push(now);
  next();
};
