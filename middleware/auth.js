module.exports = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
