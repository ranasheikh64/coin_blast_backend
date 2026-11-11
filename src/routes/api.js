const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/security');
const authController = require('../controllers/authController');
const gameController = require('../controllers/gameController');
const walletController = require('../controllers/walletController');
const adController = require('../controllers/adController');

const authLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const gameLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });
const cashoutLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 6 });

// Health Check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Coin Blast Backend', timestamp: new Date() });
});

// Auth Routes
router.post('/auth/device', authLimiter, authController.authDevice);
router.get('/auth/profile', protect, authController.getProfile);
router.post('/auth/register-account', protect, authLimiter, authController.registerAccount);
router.post('/auth/login-account', authLimiter, authController.loginAccount);

// Game Session & HMAC Anti-Cheat Routes
router.post('/game/start', protect, gameLimiter, gameController.startGame);
router.post('/game/complete', protect, gameLimiter, gameController.completeGame);

// Google AdMob Server-Side Verification (SSV) & Ad Reward Routes
router.post('/ads/prepare', protect, gameLimiter, adController.prepareAd);
router.get('/ads/ssv-callback', adController.admobSsvCallback);
router.get('/ads/status/:adNonce', protect, adController.checkAdStatus);
router.post('/ads/claim-test', protect, gameLimiter, adController.claimTestAd);

// Wallet & Lightning Cashout Routes
router.get('/wallet/info', protect, walletController.getWalletInfo);
router.post('/wallet/cashout', protect, cashoutLimiter, walletController.requestCashout);

module.exports = router;
