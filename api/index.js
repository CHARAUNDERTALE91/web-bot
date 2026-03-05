require('dotenv').config();
const express  = require('express');
const path     = require('path');
const { limiter } = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/auth');
const chatRoutes     = require('../routes/chat');
const knowledgeRoutes= require('../routes/knowledge');
const uploadRoutes   = require('../routes/upload');
const webhookRoutes  = require('../routes/webhook');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(limiter);

// Static (manifest.json, sw.js, etc.)
app.use(express.static(path.join(__dirname, '../public'), { index: false, maxAge: '1d' }));

// Serve UI
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// API routes
app.use('/chat',      authMiddleware, chatRoutes);
app.use('/knowledge', authMiddleware, knowledgeRoutes);
app.use('/upload',    authMiddleware, uploadRoutes);
app.use('/webhook',   webhookRoutes);

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
