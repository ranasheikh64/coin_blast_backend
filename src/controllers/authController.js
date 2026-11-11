const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const CoinTransaction = require('../models/CoinTransaction');

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

const formatUserResponse = (user) => {
  const pointsPerSatoshi = parseInt(process.env.POINTS_PER_SATOSHI || '100', 10);
  const cooldown = getCooldownInfo(user.lastCashoutDate);
  return {
    id: user._id,
    deviceId: user.deviceId,
    displayName: user.displayName,
    email: user.email || '',
    isRegistered: user.isRegistered || false,
    pointsBalance: user.pointsBalance,
    satoshiBalance: Math.floor(user.pointsBalance / pointsPerSatoshi),
    highestLevelUnlocked: user.highestLevelUnlocked,
    currentLevel: user.currentLevel,
    lightningAddress: user.lightningAddress,
    verifiedAdsCount: user.verifiedAdsCount || 0,
    apiSecret: user.apiSecret,
    cooldown,
  };
};

// @desc    Register or Login user strictly via Device ID (No account needed to play!)
// @route   POST /api/auth/device
exports.authDevice = async (req, res) => {
  try {
    const { deviceId, displayName } = req.body;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 4) {
      return res.status(400).json({ success: false, message: 'Valid Device ID is required' });
    }

    let user = await User.findOne({ deviceId });

    if (!user) {
      const starterCreds = 250;
      user = await User.create({
        deviceId,
        displayName: displayName || `Blaster_${Math.floor(1000 + Math.random() * 9000)}`,
        pointsBalance: starterCreds,
        apiSecret: crypto.randomBytes(32).toString('hex'),
      });

      await CoinTransaction.create({
        userId: user._id,
        type: 'signup_bonus',
        amount: starterCreds,
        balanceAfter: starterCreds,
        referenceId: `signup_${user._id.toString()}`,
        metadata: { deviceId },
      });
    } else if (!user.apiSecret) {
      user.apiSecret = crypto.randomBytes(32).toString('hex');
      await user.save();
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: formatUserResponse(user),
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

    const existingEmail = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
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
      user: formatUserResponse(user),
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
    const inputBuf = Buffer.from(inputHash, 'hex');
    const storedBuf = Buffer.from(user.passwordHash, 'hex');
    const match = inputBuf.length === storedBuf.length && crypto.timingSafeEqual(inputBuf, storedBuf);

    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.apiSecret) {
      user.apiSecret = crypto.randomBytes(32).toString('hex');
      await user.save();
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: formatUserResponse(user),
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
    res.json({
      success: true,
      user: formatUserResponse(user),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
