const crypto = require('crypto');
const GameSession = require('../models/GameSession');
const User = require('../models/User');
const { creditCoins } = require('../utils/coinLedger');

// Level configuration generator
const getLevelConfig = (level) => {
  const baseMoves = 15;
  const moves = Math.max(12, baseMoves + Math.floor((level - 1) * 0.5));

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
    minDurationSeconds: 10,
  };
};

function verifyHmacSignature(apiSecret, payloadString, providedHex) {
  if (!apiSecret || !providedHex || typeof providedHex !== 'string') return false;
  const expectedHex = crypto
    .createHmac('sha256', apiSecret)
    .update(payloadString)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// @desc    Start a secure game session
// @route   POST /api/game/start
exports.startGame = async (req, res) => {
  try {
    const requestedLevel = parseInt(req.body.level || '1', 10);
    if (!Number.isInteger(requestedLevel) || requestedLevel < 1) {
      return res.status(400).json({ success: false, message: 'Invalid level number' });
    }

    // Prevent skipping ahead to farm higher levels
    const maxAllowedLevel = Math.max(req.user.highestLevelUnlocked || 1, 1);
    if (requestedLevel > maxAllowedLevel) {
      return res.status(403).json({
        success: false,
        message: `Level ${requestedLevel} is locked. Unlock level ${maxAllowedLevel} first.`,
      });
    }

    const config = getLevelConfig(requestedLevel);
    const sessionId = crypto.randomBytes(16).toString('hex');
    const sessionNonce = crypto.randomBytes(16).toString('hex');

    const session = await GameSession.create({
      sessionId,
      sessionNonce,
      userId: req.user._id,
      level: requestedLevel,
      targetGoals: config.targetGoals,
      maxMoves: config.maxMoves,
      startTime: new Date(),
      minDurationSeconds: config.minDurationSeconds,
      status: 'in_progress',
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      sessionNonce: session.sessionNonce,
      level: session.level,
      maxMoves: session.maxMoves,
      targetGoals: session.targetGoals,
      startTime: session.startTime,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Complete game session with HMAC Signature + Atomic Lock + Anti-Cheat checks
// @route   POST /api/game/complete
exports.completeGame = async (req, res) => {
  try {
    const {
      sessionId,
      movesUsed = 0,
      totalCoinsBlasted = 0,
      isWon = false,
      timestamp,
      signature,
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    // 1. Atomically lock the session from 'in_progress' -> 'processing' to prevent race-condition double claims
    const session = await GameSession.findOneAndUpdate(
      { sessionId, userId: req.user._id, status: 'in_progress' },
      { $set: { status: 'processing' } },
      { new: true }
    );

    if (!session) {
      return res.status(400).json({
        success: false,
        message: 'Game session not found, already completed, or expired',
      });
    }

    // 2. Cryptographic HMAC-SHA256 Signature Verification
    const requireSig = process.env.REQUIRE_GAME_SIGNATURE !== 'false';
    let sigValid = false;

    if (signature && timestamp) {
      const tsNum = Number(timestamp);
      const isFresh = Number.isFinite(tsNum) && Math.abs(Date.now() - tsNum) <= 5 * 60 * 1000;
      const canonical = `${sessionId}:${session.sessionNonce}:${movesUsed}:${totalCoinsBlasted}:${Boolean(isWon)}:${timestamp}`;
      sigValid = isFresh && verifyHmacSignature(req.user.apiSecret, canonical, signature);
    }

    if (requireSig && !sigValid) {
      session.status = 'cheated';
      session.completedAt = new Date();
      await session.save();
      await User.findByIdAndUpdate(req.user._id, { $inc: { suspiciousFlags: 1 } });

      return res.status(403).json({
        success: false,
        cheated: true,
        message: 'Invalid or expired session signature. Reward rejected.',
      });
    }

    const now = new Date();
    const elapsedSeconds = (now.getTime() - new Date(session.startTime).getTime()) / 1000;

    // 3. Anti-Cheat Check 1: Minimum real-time duration
    if (elapsedSeconds < session.minDurationSeconds) {
      session.status = 'cheated';
      session.completedAt = now;
      await session.save();
      await User.findByIdAndUpdate(req.user._id, { $inc: { suspiciousFlags: 1 } });

      return res.status(403).json({
        success: false,
        cheated: true,
        message: 'Anti-cheat alert: Level completed unnaturally fast. No rewards credited.',
      });
    }

    // 4. Anti-Cheat Check 2: Realistic moves & blasted coins bounds
    const parsedMoves = Number(movesUsed);
    const parsedCoins = Number(totalCoinsBlasted);

    if (
      !Number.isInteger(parsedMoves) ||
      parsedMoves < 0 ||
      parsedMoves > session.maxMoves + 15 ||
      (isWon && parsedMoves < 1) ||
      !Number.isInteger(parsedCoins) ||
      parsedCoins < 0 ||
      parsedCoins > (parsedMoves + 3) * 36
    ) {
      session.status = 'cheated';
      session.completedAt = now;
      await session.save();
      await User.findByIdAndUpdate(req.user._id, { $inc: { suspiciousFlags: 1 } });

      return res.status(403).json({
        success: false,
        cheated: true,
        message: 'Anti-cheat alert: Invalid move or coin statistics detected.',
      });
    }

    // 5. Calculate Reward Server-Side & Enforce Daily Cap
    let rawPoints = 0;
    if (isWon) {
      const remainingMoves = Math.max(0, session.maxMoves - parsedMoves);
      rawPoints = 150 + remainingMoves * 25;
    } else {
      rawPoints = 25; // Small consolation reward
    }

    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const maxDailyPoints = parseInt(process.env.MAX_DAILY_GAME_POINTS || '15000', 10);

    const user = await User.findById(req.user._id);
    const currentDaily = user.dailyPointsDate === todayStr ? user.dailyPointsEarned : 0;
    const remainingDailyQuota = Math.max(0, maxDailyPoints - currentDaily);
    const pointsAwarded = Math.min(rawPoints, remainingDailyQuota);

    session.completedAt = now;
    session.movesUsed = parsedMoves;
    session.totalCoinsBlasted = parsedCoins;
    session.signatureVerified = sigValid;
    session.pointsAwarded = pointsAwarded;
    session.status = isWon ? 'completed' : 'failed';
    await session.save();

    // Update level progression & daily counter atomically
    const levelUpdate = {};
    if (isWon && session.level >= user.highestLevelUnlocked) {
      levelUpdate.highestLevelUnlocked = session.level + 1;
      levelUpdate.currentLevel = session.level + 1;
    }

    let updatedUser = user;

    if (pointsAwarded > 0) {
      const txType = isWon ? 'game_win' : 'game_consolation';
      const newDailyEarned = currentDaily + pointsAwarded;
      const result = await creditCoins({
        userId: user._id,
        type: txType,
        amount: pointsAwarded,
        referenceId: session.sessionId,
        metadata: {
          level: session.level,
          movesUsed: parsedMoves,
          totalCoinsBlasted: parsedCoins,
        },
        extraSet: {
          ...levelUpdate,
          dailyPointsDate: todayStr,
          dailyPointsEarned: newDailyEarned,
        },
      });
      updatedUser = result.user;
    } else if (Object.keys(levelUpdate).length > 0) {
      updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $set: levelUpdate },
        { new: true }
      );
    }

    res.json({
      success: true,
      isWon: Boolean(isWon),
      pointsAwarded,
      dailyCapReached: pointsAwarded < rawPoints,
      newPointsBalance: updatedUser.pointsBalance,
      highestLevelUnlocked: updatedUser.highestLevelUnlocked,
      currentLevel: updatedUser.currentLevel,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
