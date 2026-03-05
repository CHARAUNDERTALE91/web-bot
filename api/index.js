require('dotenv').config();
const express = require('express');
const path = require('path');
const { limiter } = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/auth');
const knowledgeRoutes = require('../routes/knowledge');
const webhookRoutes = require('../routes/webhook');
const chatRoutes = require('../routes/chat');

const app = express();
app.use(express.json());

// Global rate limit
app.use(limiter);

// Serve UI — halaman chat
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Routes
app.use('/chat', authMiddleware, chatRoutes);
app.use('/knowledge', authMiddleware, knowledgeRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: '🔍 Endpoint not found!' });
});

module.exports = app;
