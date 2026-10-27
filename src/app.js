require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const apiRoutes = require('./routes/api');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 1. Safe JSON parsing error catcher (prevents raw SyntaxError crash)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or malformed JSON payload provided',
    });
  }
  next(err);
});

// Root route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Coin Blast Backend API',
    version: '1.0.0',
    timestamp: new Date(),
  });
});

// Ensure MongoDB connection for every request (cached in serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// Routes
app.use('/api', apiRoutes);

// 2. Catch-all 404 Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
  });
});

// 3. Centralized Global Error Handler
app.use((err, req, res, next) => {
  console.error(`[Server Error] ${err.name || 'Error'}: ${err.message || err}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Handle uncaught exceptions and unhandled rejections cleanly
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 5000;

// Connect to Database and start server locally (on Vercel, serverless handles requests without app.listen)
if (!process.env.VERCEL) {
  connectDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Coin Blast Server running on port ${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to start server:', err);
  });
}

module.exports = app;

