module.exports = (req, res, next) => {
  const key = req.headers['x-owner-key'] || req.body?.ownerKey;
  if (!key || key !== process.env.OWNER_SECRET) {
    return res.status(403).json({ error: 'Owner key required' });
  }
  next();
};
