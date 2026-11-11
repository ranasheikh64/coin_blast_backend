const crypto = require('crypto');
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      sparse: true,
    },
    displayName: {
      type: String,
      default: 'Crypto Blaster',
    },
    pointsBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    satoshiBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentLevel: {
      type: Number,
      default: 1,
    },
    highestLevelUnlocked: {
      type: Number,
      default: 1,
    },
    lastCashoutDate: {
      type: Date,
      default: null,
    },
    lightningAddress: {
      type: String,
      trim: true,
      default: '',
    },
    isRegistered: {
      type: Boolean,
      default: false,
    },
    passwordHash: {
      type: String,
      default: '',
    },
    salt: {
      type: String,
      default: '',
    },
    // Per-user cryptographic HMAC secret for signing game completions
    apiSecret: {
      type: String,
      default: () => crypto.randomBytes(32).toString('hex'),
    },
    // Total ads genuinely verified by AdMob SSV (required before cashout)
    verifiedAdsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Daily points cap tracking (UTC YYYY-MM-DD)
    dailyPointsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    dailyPointsDate: {
      type: String,
      default: '',
    },
    suspiciousFlags: {
      type: Number,
      default: 0,
      min: 0,
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
