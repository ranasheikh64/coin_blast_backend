const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const authController = require('../controllers/authController');
const gameController = require('../controllers/gameController');
const walletController = require('../controllers/walletController');

// Health Check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Coin Blast Backend', timestamp: new Date() });
});

// Auth Routes
router.post('/auth/device', authController.authDevice);
router.get('/auth/profile', protect, authController.getProfile);
router.post('/auth/register-account', protect, authController.registerAccount);
router.post('/auth/login-account', authController.loginAccount);

// Game Session & Anti-Cheat Routes
router.post('/game/start', protect, gameController.startGame);
router.post('/game/complete', protect, gameController.completeGame);

// Wallet & Lightning Cashout Routes
router.get('/wallet/info', protect, walletController.getWalletInfo);
router.post('/wallet/cashout', protect, walletController.requestCashout);

module.exports = router;
