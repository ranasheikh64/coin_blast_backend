const mongoose = require('mongoose');

const AdRewardSchema = new mongoose.Schema(
  {
    adNonce: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    placement: {
      type: String,
      enum: ['coins_bonus', 'energy_moves'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'expired'],
      default: 'pending',
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    rewardAmount: {
      type: Number,
      default: 0,
    },
    adUnit: {
      type: String,
      default: '',
    },
    ssvTimestamp: {
      type: Number,
      default: 0,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdReward', AdRewardSchema);
