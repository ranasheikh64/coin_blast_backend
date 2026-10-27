const axios = require('axios');
const User = require('../models/User');
const Cashout = require('../models/Cashout');

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

// @desc    Get wallet info, Satoshi balance, and cashout cooldown
// @route   GET /api/wallet/info
exports.getWalletInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const pointsPerSatoshi = parseInt(process.env.POINTS_PER_SATOSHI || '100', 10);
    const satoshis = Math.floor(user.pointsBalance / pointsPerSatoshi);
    const cooldown = getCooldownInfo(user.lastCashoutDate);

    // Get recent cashouts
    const recentCashouts = await Cashout.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      pointsBalance: user.pointsBalance,
      satoshiBalance: satoshis,
      pointsPerSatoshi,
      minimumWithdrawalPoints: 5000, // 50 Satoshis
      lightningAddress: user.lightningAddress || '',
      isRegistered: user.isRegistered || false,
      cooldown,
      recentCashouts,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Request Bitcoin Lightning cashout (with 7-day cooldown check & registration check)
// @route   POST /api/wallet/cashout
exports.requestCashout = async (req, res) => {
  try {
    const { lightningAddress } = req.body;
    const user = await User.findById(req.user._id);

    // Require account registration before withdrawal
    if (!user.isRegistered) {
      return res.status(403).json({
        success: false,
        requireRegistration: true,
        message: 'Please create an account before cashing out to secure your earnings!',
      });
    }

    if (!lightningAddress || !lightningAddress.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid Lightning Address (e.g. user@zbd.gg or user@walletofsatoshi.com)',
      });
    }

    const cooldown = getCooldownInfo(user.lastCashoutDate);
    if (!cooldown.canCashout) {
      return res.status(400).json({
        success: false,
        message: `Cashout is currently locked. Next cash out available in ${Math.ceil(cooldown.secondsRemaining / 3600)} hours.`,
        cooldown,
      });
    }

    const pointsPerSatoshi = parseInt(process.env.POINTS_PER_SATOSHI || '100', 10);
    const minPoints = 5000;

    if (user.pointsBalance < minPoints) {
      return res.status(400).json({
        success: false,
        message: `Insufficient points. You need at least ${minPoints.toLocaleString()} points to cash out.`,
      });
    }

    const satoshisToCashout = Math.floor(user.pointsBalance / pointsPerSatoshi);
    const pointsToDeduct = satoshisToCashout * pointsPerSatoshi;

    let txId = `SIM_LN_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let status = 'completed';
    let gatewayResponse = { simulated: true, note: 'Processed via Lightning Network Engine' };

    // If real ZEBEDEE API key provided, attempt live transfer
    if (process.env.ZEBEDEE_API_KEY) {
      try {
        const zbdResponse = await axios.post(
          'https://api.zebedee.io/v0/ln-address/send-payment',
          {
            lnAddress: lightningAddress,
            amount: (satoshisToCashout * 1000).toString(), // millisatoshis
            comment: 'Coin Blast Game Reward Cashout',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.ZEBEDEE_API_KEY,
            },
          }
        );
        txId = zbdResponse.data.data?.id || txId;
        gatewayResponse = zbdResponse.data;
      } catch (zbdErr) {
        console.error('ZEBEDEE API Error:', zbdErr.response?.data || zbdErr.message);
        return res.status(502).json({
          success: false,
          message: 'Lightning payout gateway error: ' + (zbdErr.response?.data?.message || zbdErr.message),
        });
      }
    }

    // Deduct points and update cooldown date
    user.pointsBalance -= pointsToDeduct;
    user.lastCashoutDate = new Date();
    user.lightningAddress = lightningAddress;
    await user.save();

    // Create cashout log
    const cashout = await Cashout.create({
      userId: user._id,
      pointsDeducted: pointsToDeduct,
      satoshisSent: satoshisToCashout,
      lightningAddress,
      status,
      txId,
      gatewayResponse,
    });

    res.json({
      success: true,
      message: `Successfully sent ${satoshisToCashout} Satoshis to ${lightningAddress}!`,
      cashout: {
        id: cashout._id,
        satoshis: satoshisToCashout,
        lightningAddress,
        txId,
        date: cashout.createdAt,
      },
      newPointsBalance: user.pointsBalance,
      cooldown: getCooldownInfo(user.lastCashoutDate),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
