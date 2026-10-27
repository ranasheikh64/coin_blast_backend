const crypto = require('crypto');
const GameSession = require('../models/GameSession');
const User = require('../models/User');

// Level configuration generator
const getLevelConfig = (level) => {
  const baseMoves = 15;
  const moves = Math.max(12, baseMoves + Math.floor((level - 1) * 0.5));

  // Determine target goals based on level
  const targets = [];
  if (level === 1) {
    targets.push({ coinType: 'BTC', target: 15, collected: 0 });
  } else if (level === 2) {
    targets.push({ coinType: 'BTC', target: 18, collected: 0 });
    targets.push({ coinType: 'ETH', target: 12, collected: 0 });
  } else if (level === 3) {
    targets.push({ coinType: 'SOL', target: 20, collected: 0 });
    targets.push({ coinType: 'DOGE', target: 15, collected: 0 });
  } else {
    targets.push({ coinType: 'BTC', target: 20 + level, collected: 0 });
    targets.push({ coinType: 'ETH', target: 15 + level, collected: 0 });
  }

  return {
    level,
    maxMoves: moves,
    targetGoals: targets,
    minDurationSeconds: 12, // Anti-cheat baseline threshold
  };
};

// @desc    Start a secure game session
// @route   POST /api/game/start
exports.startGame = async (req, res) => {
  try {
    const { level } = req.body;
    const currentLevel = parseInt(level || '1', 10);
    const config = getLevelConfig(currentLevel);

    const sessionId = crypto.randomBytes(16).toString('hex');

    const session = await GameSession.create({
      sessionId,
      userId: req.user._id,
      level: currentLevel,
      targetGoals: config.targetGoals,
      maxMoves: config.maxMoves,
      startTime: new Date(),
      minDurationSeconds: config.minDurationSeconds,
      status: 'in_progress',
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      level: session.level,
      maxMoves: session.maxMoves,
      targetGoals: session.targetGoals,
      startTime: session.startTime,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete game session with Anti-Cheat checks
// @route   POST /api/game/complete
exports.completeGame = async (req, res) => {
  try {
    const { sessionId, movesUsed, totalCoinsBlasted, isWon } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const session = await GameSession.findOne({ sessionId, userId: req.user._id });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Game session not found' });
    }

    if (session.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Session already completed or expired' });
    }

    const now = new Date();
    const elapsedSeconds = (now.getTime() - new Date(session.startTime).getTime()) / 1000;

    // ANTI-CHEAT CHECK 1: Real-time duration check
    if (elapsedSeconds < session.minDurationSeconds) {
      session.status = 'cheated';
      session.completedAt = now;
      await session.save();

      return res.status(403).json({
        success: false,
        cheated: true,
        message: 'Anti-cheat alert: Level completed unnaturally fast. No rewards credited.',
      });
    }

    // ANTI-CHEAT CHECK 2: Moves validation
    if (movesUsed > session.maxMoves + 10) {
      session.status = 'cheated';
      await session.save();
      return res.status(403).json({
        success: false,
        cheated: true,
        message: 'Anti-cheat alert: Moves exceeded allowed limit.',
      });
    }

    session.completedAt = now;
    session.movesUsed = movesUsed || 0;
    session.totalCoinsBlasted = totalCoinsBlasted || 0;

    let pointsAwarded = 0;

    if (isWon) {
      session.status = 'completed';
      // Calculate Bling points: base 800 + bonus for remaining moves
      const remainingMoves = Math.max(0, session.maxMoves - (movesUsed || 0));
      pointsAwarded = 800 + remainingMoves * 50;

      session.pointsAwarded = pointsAwarded;

      // Update user points and unlock next level
      const user = await User.findById(req.user._id);
      user.pointsBalance += pointsAwarded;
      if (session.level >= user.highestLevelUnlocked) {
        user.highestLevelUnlocked = session.level + 1;
      }
      user.currentLevel = session.level + 1;
      await user.save();
    } else {
      session.status = 'failed';
      // Partial consolation points (100 pts)
      pointsAwarded = 100;
      session.pointsAwarded = pointsAwarded;

      const user = await User.findById(req.user._id);
      user.pointsBalance += pointsAwarded;
      await user.save();
    }

    await session.save();

    const updatedUser = await User.findById(req.user._id);

    res.json({
      success: true,
      isWon,
      pointsAwarded,
      newPointsBalance: updatedUser.pointsBalance,
      highestLevelUnlocked: updatedUser.highestLevelUnlocked,
      currentLevel: updatedUser.currentLevel,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
