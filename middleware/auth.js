// Middleware: cek API Key buat akses umum
const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: '🔑 API Key required!',
      hint: 'Add header: x-api-key: YOUR_KEY'
    });
  }

  if (apiKey !== process.env.API_KEY && 
      apiKey !== process.env.OWNER_SECRET) {
    return res.status(403).json({ 
      error: '🚫 Invalid API Key!' 
    });
  }

  next();
};

module.exports = authMiddleware;
