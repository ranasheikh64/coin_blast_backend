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
    isBanned: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
