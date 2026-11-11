const crypto = require('crypto');
const axios = require('axios');
const AdReward = require('../models/AdReward');
const User = require('../models/User');
const { creditCoins } = require('../utils/coinLedger');

const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let cachedPublicKeys = null;
let keysFetchedAt = 0;
const KEY_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

async function getAdMobPublicKeyPem(keyId) {
  const now = Date.now();
  if (!cachedPublicKeys || now - keysFetchedAt > KEY_CACHE_TTL_MS) {
    const res = await axios.get(ADMOB_KEYS_URL, { timeout: 8000 });
    const keysList = res.data?.keys || [];
    const map = new Map();
    for (const k of keysList) {
      if (k.keyId && k.pem) {
        map.set(String(k.keyId), k.pem);
      }
    }
    cachedPublicKeys = map;
    keysFetchedAt = now;
  }

  let pem = cachedPublicKeys.get(String(keyId));
  // If key rotated, force refresh once
  if (!pem) {
    const res = await axios.get(ADMOB_KEYS_URL, { timeout: 8000 });
    const keysList = res.data?.keys || [];
    const map = new Map();
    for (const k of keysList) {
      if (k.keyId && k.pem) {
        map.set(String(k.keyId), k.pem);
      }
    }
    cachedPublicKeys = map;
    keysFetchedAt = Date.now();
    pem = cachedPublicKeys.get(String(keyId));
  }

  return pem || null;
}

function verifyAdMobSsvSignature(originalUrl, signatureParam, keyIdPem) {
  const qIndex = originalUrl.indexOf('?');
  if (qIndex === -1) return false;

  const rawQuery = originalUrl.slice(qIndex + 1);
  const sigIndex = rawQuery.indexOf('&signature=');
  if (sigIndex === -1) return false;

  // Google AdMob signs the exact UTF-8 query string before '&signature='
  const messageToVerify = rawQuery.slice(0, sigIndex);

  // Google uses URL-safe base64 for the signature parameter
  const normalizedSig = decodeURIComponent(signatureParam)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const verifier = crypto.createVerify('SHA256');
  verifier.update(messageToVerify);
  verifier.end();

  return verifier.verify(keyIdPem, Buffer.from(normalizedSig, 'base64'));
}

// @desc    Prepare an ad watch nonce before showing a Rewarded Ad
// @route   POST /api/ads/prepare
exports.prepareAd = async (req, res) => {
  try {
    const { placement } = req.body;
    const validPlacement =
      placement === 'energy_moves' ? 'energy_moves' : 'coins_bonus';

    const adNonce = crypto.randomBytes(16).toString('hex');

    await AdReward.create({
      adNonce,
      userId: req.user._id,
      placement: validPlacement,
      status: 'pending',
    });

    res.json({
      success: true,
      adNonce,
      userId: req.user._id.toString(),
      placement: validPlacement,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Google AdMob Server-Side Verification (SSV) Webhook
// @route   GET /api/ads/ssv-callback
exports.admobSsvCallback = async (req, res) => {
  try {
    const {
      signature,
      key_id,
      transaction_id,
      user_id,
      custom_data,
      reward_amount,
      ad_unit,
      timestamp,
    } = req.query;

    if (!signature || !key_id || !transaction_id || !user_id) {
      return res.status(400).send('Missing required SSV parameters');
    }

    // 1. Fetch Google's official ECDSA public key and verify cryptographic signature
    const publicKeyPem = await getAdMobPublicKeyPem(key_id);
    if (!publicKeyPem) {
      return res.status(403).send('Unknown key_id');
    }

    const isValidSig = verifyAdMobSsvSignature(
      req.originalUrl,
      String(signature),
      publicKeyPem
    );

    if (!isValidSig) {
      console.warn('[AdMob SSV] Invalid signature rejected for tx:', transaction_id);
      return res.status(403).send('Invalid SSV signature');
    }

    // 2. Check replay protection on transaction_id
    const existingTx = await AdReward.findOne({ transactionId: String(transaction_id) });
    if (existingTx) {
      // Already processed idempotently -> return 200 OK so AdMob stops retrying
      return res.status(200).send('OK');
    }

    const user = await User.findById(user_id);
    if (!user || user.isBanned) {
      return res.status(404).send('User not found');
    }

    const adNonce = custom_data ? String(custom_data) : '';
    let adRecord = adNonce ? await AdReward.findOne({ adNonce, userId: user._id }) : null;

    if (adRecord && adRecord.status === 'verified') {
      return res.status(200).send('OK');
    }

    const placement = adRecord?.placement || 'coins_bonus';

    if (!adRecord) {
      adRecord = await AdReward.create({
        adNonce: adNonce || `ssv_${transaction_id}`,
        userId: user._id,
        placement,
        status: 'verified',
        transactionId: String(transaction_id),
        rewardAmount: parseInt(reward_amount || '0', 10),
        adUnit: String(ad_unit || ''),
        ssvTimestamp: parseInt(timestamp || '0', 10),
        verifiedAt: new Date(),
      });
    } else {
      const locked = await AdReward.findOneAndUpdate(
        { _id: adRecord._id, status: 'pending' },
        {
          $set: {
            status: 'verified',
            transactionId: String(transaction_id),
            rewardAmount: parseInt(reward_amount || '0', 10),
            adUnit: String(ad_unit || ''),
            ssvTimestamp: parseInt(timestamp || '0', 10),
            verifiedAt: new Date(),
          },
        },
        { new: true }
      );
      if (!locked) {
        return res.status(200).send('OK');
      }
    }

    // 3. Grant reward server-side
    const adCoinsReward = parseInt(process.env.AD_COINS_REWARD || '300', 10);

    if (placement === 'coins_bonus') {
      await creditCoins({
        userId: user._id,
        type: 'ad_reward',
        amount: adCoinsReward,
        referenceId: `admob_${transaction_id}`,
        metadata: { adUnit: ad_unit, adNonce, placement },
        extraInc: { verifiedAdsCount: 1 },
      });
    } else {
      // Energy moves ad still counts as a verified ad watch
      await User.findByIdAndUpdate(user._id, {
        $inc: { verifiedAdsCount: 1 },
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('[AdMob SSV Error]:', error.message);
    return res.status(500).send('Internal error');
  }
};

// @desc    Check if a prepared ad nonce was verified via AdMob SSV
// @route   GET /api/ads/status/:adNonce
exports.checkAdStatus = async (req, res) => {
  try {
    const { adNonce } = req.params;
    const adRecord = await AdReward.findOne({
      adNonce,
      userId: req.user._id,
    });

    if (!adRecord) {
      return res.status(404).json({ success: false, message: 'Ad session not found' });
    }

    const user = await User.findById(req.user._id);
    const adCoinsReward = parseInt(process.env.AD_COINS_REWARD || '300', 10);

    res.json({
      success: true,
      verified: adRecord.status === 'verified',
      placement: adRecord.placement,
      pointsAwarded: adRecord.status === 'verified' && adRecord.placement === 'coins_bonus'
        ? adCoinsReward
        : 0,
      newPointsBalance: user.pointsBalance,
      verifiedAdsCount: user.verifiedAdsCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Claim test ad reward ONLY when ALLOW_TEST_AD_REWARDS=true (for dev/test AdMob IDs)
// @route   POST /api/ads/claim-test
exports.claimTestAd = async (req, res) => {
  try {
    if (process.env.ALLOW_TEST_AD_REWARDS !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Test ad bypass is disabled in production. AdMob SSV verification is required.',
      });
    }

    const { adNonce } = req.body;
    if (!adNonce) {
      return res.status(400).json({ success: false, message: 'adNonce is required' });
    }

    const locked = await AdReward.findOneAndUpdate(
      { adNonce, userId: req.user._id, status: 'pending' },
      {
        $set: {
          status: 'verified',
          transactionId: `test_ad_${adNonce}`,
          verifiedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!locked) {
      return res.status(400).json({
        success: false,
        message: 'Ad reward already claimed or invalid nonce',
      });
    }

    const adCoinsReward = parseInt(process.env.AD_COINS_REWARD || '300', 10);
    let updatedUser;

    if (locked.placement === 'coins_bonus') {
      const result = await creditCoins({
        userId: req.user._id,
        type: 'ad_reward',
        amount: adCoinsReward,
        referenceId: `test_ad_${adNonce}`,
        metadata: { testMode: true, placement: locked.placement },
        extraInc: { verifiedAdsCount: 1 },
      });
      updatedUser = result.user;
    } else {
      updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { verifiedAdsCount: 1 } },
        { new: true }
      );
    }

    res.json({
      success: true,
      verified: true,
      pointsAwarded: locked.placement === 'coins_bonus' ? adCoinsReward : 0,
      newPointsBalance: updatedUser.pointsBalance,
      verifiedAdsCount: updatedUser.verifiedAdsCount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

