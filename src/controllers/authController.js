const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: '30d',
  });
};

const hashPassword = (password, salt) => {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
};

const getCooldownInfo = (lastCashoutDate) => {
  const cooldownDays = parseInt(process.env.CASHOUT_COOLDOWN_DAYS || '7', 10);
  if (!lastCashoutDate) {
    return {
      canCashout: true,
      secondsRemaining: 0,
      nextAvailableDate: null,
    };
  }

  const lastDate = new Date(lastCashoutDate).getTime();
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const nextDate = new Date(lastDate + cooldownMs);
  const now = Date.now();

  const msRemaining = nextDate.getTime() - now;
  if (msRemaining <= 0) {
    return {
      canCashout: true,
      secondsRemaining: 0,
      nextAvailableDate: null,
    };
  }

  return {
    canCashout: false,
    secondsRemaining: Math.floor(msRemaining / 1000),
    nextAvailableDate: nextDate.toISOString(),
  };
};

// @desc    Register or Login user strictly via Device ID (No account needed to play!)
// @route   POST /api/auth/device
exports.authDevice = async (req, res) => {
  try {
    const { deviceId, displayName } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'Device ID is required' });
    }

    let user = await User.findOne({ deviceId });

    if (!user) {
      user = await User.create({
        deviceId,
        displayName: displayName || `Blaster_${Math.floor(1000 + Math.random() * 9000)}`,
        pointsBalance: 250, // Starter creds
      });
    }

    const token = generateToken(user._id);
    const cooldown = getCooldownInfo(user.lastCashoutDate);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        deviceId: user.deviceId,
        displayName: user.displayName,
        email: user.email || '',
        isRegistered: user.isRegistered || false,
        pointsBalance: user.pointsBalance,
        satoshiBalance: Math.floor(user.pointsBalance / (parseInt(process.env.POINTS_PER_SATOSHI || '100', 10))),
        highestLevelUnlocked: user.highestLevelUnlocked,
        currentLevel: user.currentLevel,
        lightningAddress: user.lightningAddress,
        cooldown,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Register / Link Account when user wants to Cash Out
// @route   POST /api/auth/register-account
exports.registerAccount = async (req, res) => {
  try {
    const { email, password, lightningAddress } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User session not found' });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required to register an account' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    // Check if email already used by another registered account
    const existingEmail = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
    if (existingEmail && existingEmail.isRegistered) {
      return res.status(400).json({ success: false, message: 'This email is already registered to another account' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    user.email = email.toLowerCase().trim();
    user.salt = salt;
    user.passwordHash = passwordHash;
    user.isRegistered = true;
    if (lightningAddress) {
      user.lightningAddress = lightningAddress.trim();
    }

    await user.save();

    res.json({
      success: true,
      message: 'Account registered successfully! You can now withdraw rewards.',
      user: {
        id: user._id,
        deviceId: user.deviceId,
        email: user.email,
        isRegistered: true,
        displayName: user.displayName,
        pointsBalance: user.pointsBalance,
        lightningAddress: user.lightningAddress,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Login with existing registered account (allows restoring balance on another device)
// @route   POST /api/auth/login-account
exports.loginAccount = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.isRegistered || !user.passwordHash) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    const inputHash = hashPassword(password, user.salt);
    if (inputHash !== user.passwordHash) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);
    const cooldown = getCooldownInfo(user.lastCashoutDate);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        deviceId: user.deviceId,
        displayName: user.displayName,
        email: user.email,
        isRegistered: true,
        pointsBalance: user.pointsBalance,
        satoshiBalance: Math.floor(user.pointsBalance / (parseInt(process.env.POINTS_PER_SATOSHI || '100', 10))),
        highestLevelUnlocked: user.highestLevelUnlocked,
        currentLevel: user.currentLevel,
        lightningAddress: user.lightningAddress,
        cooldown,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current user profile & live cooldown
// @route   GET /api/auth/profile
exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    const cooldown = getCooldownInfo(user.lastCashoutDate);

    res.json({
      success: true,
      user: {
        id: user._id,
        deviceId: user.deviceId,
        displayName: user.displayName,
        email: user.email || '',
        isRegistered: user.isRegistered || false,
        pointsBalance: user.pointsBalance,
        satoshiBalance: Math.floor(user.pointsBalance / (parseInt(process.env.POINTS_PER_SATOSHI || '100', 10))),
        highestLevelUnlocked: user.highestLevelUnlocked,
        currentLevel: user.currentLevel,
        lightningAddress: user.lightningAddress,
        cooldown,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
