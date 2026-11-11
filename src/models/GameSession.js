const mongoose = require('mongoose');

const GameSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sessionNonce: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    level: {
      type: Number,
      required: true,
      default: 1,
    },
    targetGoals: [
      {
        coinType: String,
        target: Number,
        collected: { type: Number, default: 0 },
      },
    ],
    maxMoves: {
      type: Number,
      required: true,
      default: 15,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    minDurationSeconds: {
      type: Number,
      default: 12, // Anti-cheat baseline threshold
    },
    status: {
      type: String,
      enum: ['in_progress', 'processing', 'completed', 'failed', 'cheated'],
      default: 'in_progress',
    },
    signatureVerified: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    pointsAwarded: {
      type: Number,
      default: 0,
    },
    movesUsed: {
      type: Number,
      default: 0,
    },
    totalCoinsBlasted: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GameSession', GameSessionSchema);
