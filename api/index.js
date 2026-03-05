require('dotenv').config();
const express = require('express');
const { limiter } = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/auth');
const knowledgeRoutes = require('../routes/knowledge');
const webhookRoutes = require('../routes/webhook');

const app = express();
app.use(express.json());

// Global rate limit
app.use(limiter);

// ROOT
app.get('/', (req, res) => {
  res.json({
    status: '🔥 Bot API Live!',
    version: '2.0.0',
    endpoints: {
      public: ['GET /knowledge', 'GET /knowledge/search?q='],
      webhook: ['POST /webhook (x-api-key required)'],
      owner_only: [
        'POST /knowledge (x-owner-key)',
        'PUT /knowledge/:id (x-owner-key)',
        'DELETE /knowledge/:id (x-owner-key)'
      ]
    }
  });
});

// Routes
app.use('/knowledge', authMiddleware, knowledgeRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: '🔍 Endpoint not found!' });
});

module.exports = app;
