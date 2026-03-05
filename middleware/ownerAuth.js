// Middleware: HANYA OWNER yang bisa akses
// Buat DELETE, UPDATE, INSERT knowledge
const ownerAuth = (req, res, next) => {
  const ownerKey = req.headers['x-owner-key'];

  if (!ownerKey) {
    return res.status(401).json({ 
      error: '👑 Owner key required!',
      hint: 'Add header: x-owner-key: YOUR_OWNER_SECRET'
    });
  }

  if (ownerKey !== process.env.OWNER_SECRET) {
    return res.status(403).json({ 
      error: '🚫 Bukan owner! Minggat! wkwk',
      status: 'FORBIDDEN'
    });
  }

  req.isOwner = true;
  next();
};

module.exports = ownerAuth;
