const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const Cashout = require('../models/Cashout');
const { debitCoinsForCashout, refundCashout } = require('../utils/coinLedger');

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

// @desc    Get wallet info, Satoshi balance, verified ads count, and cashout cooldown
// @route   GET /api/wallet/info
exports.getWalletInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const pointsPerSatoshi = parseInt(process.env.POINTS_PER_SATOSHI || '100', 10);
    const minPoints = parseInt(process.env.MINIMUM_CASHOUT_POINTS || '1000', 10);
    const minAdsForCashout = parseInt(process.env.MIN_ADS_FOR_CASHOUT || '3', 10);

    const satoshis = Math.floor(user.pointsBalance / pointsPerSatoshi);
    const cooldown = getCooldownInfo(user.lastCashoutDate);

    const recentCashouts = await Cashout.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      pointsBalance: user.pointsBalance,
      satoshiBalance: satoshis,
      pointsPerSatoshi,
      minimumWithdrawalPoints: minPoints,
      verifiedAdsCount: user.verifiedAdsCount || 0,
      minAdsForCashout,
      lightningAddress: user.lightningAddress || '',
      isRegistered: user.isRegistered || false,
      email: user.email || '',
      cooldown,
      recentCashouts,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Request Bitcoin Lightning cashout (atomic debit + ZBD transfer + auto-refund on error)
// @route   POST /api/wallet/cashout
exports.requestCashout = async (req, res) => {
  try {
    const { lightningAddress } = req.body;
    const user = await User.findById(req.user._id);

    if (!user || user.isBanned) {
      return res.status(403).json({ success: false, message: 'Account not eligible' });
    }

    // 1. Require registered account
    if (!user.isRegistered) {
      return res.status(403).json({
        success: false,
        requireRegistration: true,
        message: 'Please register or sign in before cashing out.',
      });
    }

    // 2. Validate Lightning Address format
    const cleanAddr = typeof lightningAddress === 'string' ? lightningAddress.trim() : '';
    const lnRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!lnRegex.test(cleanAddr)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Lightning Address (e.g. user@zbd.gg)',
      });
    }

    // 3. Enforce cooldown
    const cooldown = getCooldownInfo(user.lastCashoutDate);
    if (!cooldown.canCashout) {
      return res.status(400).json({
        success: false,
        message: `Cashout locked. Next cashout available in ${Math.ceil(cooldown.secondsRemaining / 3600)} hours.`,
        cooldown,
      });
    }

    // 4. Enforce verified AdMob ad-watch threshold before payout
    const minAdsForCashout = parseInt(process.env.MIN_ADS_FOR_CASHOUT || '3', 10);
    if ((user.verifiedAdsCount || 0) < minAdsForCashout) {
      return res.status(403).json({
        success: false,
        message: `Watch at least ${minAdsForCashout} rewarded ads before cashing out (${user.verifiedAdsCount || 0}/${minAdsForCashout}).`,
      });
    }

    // 5. Minimum balance check
    const pointsPerSatoshi = parseInt(process.env.POINTS_PER_SATOSHI || '100', 10);
    const minPoints = parseInt(process.env.MINIMUM_CASHOUT_POINTS || '1000', 10);

    if (user.pointsBalance < minPoints) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Minimum ${minPoints} points required.`,
      });
    }

    // 6. Verify gateway availability BEFORE deducting
    const hasZbdKey = Boolean(process.env.ZEBEDEE_API_KEY && process.env.ZEBEDEE_API_KEY.trim());
    const allowSim = process.env.ALLOW_SIMULATED_CASHOUT === 'true';

    if (!hasZbdKey && !allowSim) {
      return res.status(503).json({
        success: false,
        message: 'Payout gateway is currently configuring. Please try again later.',
      });
    }

    const satoshisToCashout = Math.floor(user.pointsBalance / pointsPerSatoshi);
    const pointsToDeduct = satoshisToCashout * pointsPerSatoshi;
    const cashoutRefId = `cashout_${user._id.toString()}_${crypto.randomBytes(8).toString('hex')}`;
    const previousCashoutDate = user.lastCashoutDate;

    // 7. Atomically lock & deduct balance first (prevents double-spend race condition)
    const debitResult = await debitCoinsForCashout({
      userId: user._id,
      amount: pointsToDeduct,
      referenceId: cashoutRefId,
      metadata: { lightningAddress: cleanAddr, satoshis: satoshisToCashout },
      extraSet: {
        lastCashoutDate: new Date(),
        lightningAddress: cleanAddr,
      },
    });

    if (!debitResult) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance or concurrent cashout in progress.',
      });
    }

    let txId = `SIM_LN_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let gatewayResponse = { simulated: true, note: 'Simulated test payout' };

    if (hasZbdKey) {
      try {
        const zbdResponse = await axios.post(
          'https://api.zebedee.io/v0/ln-address/send-payment',
          {
            lnAddress: cleanAddr,
            amount: (satoshisToCashout * 1000).toString(), // millisatoshis
            comment: 'Coin Blast Game Reward Cashout',
          },
          {
            headers: {
              'Content-Type': 'application/json',
              apikey: process.env.ZEBEDEE_API_KEY.trim(),
            },
            timeout: 15000,
          }
        );
        txId = zbdResponse.data?.data?.id || txId;
        gatewayResponse = zbdResponse.data;
      } catch (zbdErr) {
        console.error('ZEBEDEE API Error:', zbdErr.response?.data || zbdErr.message);

        // 8. Automatic atomic refund so ZERO coins are lost on gateway failure!
        await refundCashout({
          userId: user._id,
          amount: pointsToDeduct,
          referenceId: cashoutRefId,
          previousCashoutDate,
          metadata: { reason: zbdErr.response?.data?.message || zbdErr.message },
        });

        await Cashout.create({
          userId: user._id,
          pointsDeducted: pointsToDeduct,
          satoshisSent: satoshisToCashout,
          lightningAddress: cleanAddr,
          status: 'failed',
          txId: cashoutRefId,
          gatewayResponse: zbdErr.response?.data || { error: zbdErr.message },
        });

        return res.status(502).json({
          success: false,
          refunded: true,
          message: 'Lightning transfer failed; your coins have been safely refunded.',
        });
      }
    }

    const cashout = await Cashout.create({
      userId: user._id,
      pointsDeducted: pointsToDeduct,
      satoshisSent: satoshisToCashout,
      lightningAddress: cleanAddr,
      status: 'completed',
      txId,
      gatewayResponse,
    });

    res.json({
      success: true,
      message: `Sent ${satoshisToCashout} Satoshis to ${cleanAddr}`,
      cashout,
      newPointsBalance: debitResult.user.pointsBalance,
      satoshiBalance: Math.floor(debitResult.user.pointsBalance / pointsPerSatoshi),
      cooldown: getCooldownInfo(debitResult.user.lastCashoutDate),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
