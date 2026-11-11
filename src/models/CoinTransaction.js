const mongoose = require('mongoose');

const CoinTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'signup_bonus',
        'game_win',
        'game_consolation',
        'ad_reward',
        'cashout_deduction',
        'cashout_refund',
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    referenceId: {
      type: String,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent duplicate credit or duplicate deduction for the exact same event
CoinTransactionSchema.index({ type: 1, referenceId: 1 }, { unique: true });

module.exports = mongoose.model('CoinTransaction', CoinTransactionSchema);
