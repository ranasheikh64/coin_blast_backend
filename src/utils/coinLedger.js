const User = require('../models/User');
const CoinTransaction = require('../models/CoinTransaction');

/**
 * Atomically credit coins to a user and write an immutable ledger entry.
 * Guaranteed idempotent via unique (type, referenceId) index.
 */
async function creditCoins({
  userId,
  type,
  amount,
  referenceId,
  metadata = null,
  extraInc = {},
  extraSet = null,
}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Credit amount must be a positive integer');
  }

  // Check if already credited for idempotency before mutating balance
  const existing = await CoinTransaction.findOne({ type, referenceId });
  if (existing) {
    const user = await User.findById(userId);
    return { user, transaction: existing, duplicate: true };
  }

  const update = {
    $inc: { pointsBalance: amount, ...extraInc },
  };
  if (extraSet && Object.keys(extraSet).length > 0) {
    update.$set = extraSet;
  }

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, isBanned: false },
    update,
    { new: true }
  );

  if (!updatedUser) {
    throw new Error('User not found or suspended');
  }

  try {
    const transaction = await CoinTransaction.create({
      userId,
      type,
      amount,
      balanceAfter: updatedUser.pointsBalance,
      referenceId,
      metadata,
    });
    return { user: updatedUser, transaction, duplicate: false };
  } catch (err) {
    // Race condition duplicate detected on unique index -> roll back the $inc cleanly
    if (err && err.code === 11000) {
      const rollbackInc = { pointsBalance: -amount };
      for (const [k, v] of Object.entries(extraInc)) {
        rollbackInc[k] = -v;
      }
      const revertedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: rollbackInc },
        { new: true }
      );
      const existingTx = await CoinTransaction.findOne({ type, referenceId });
      return { user: revertedUser, transaction: existingTx, duplicate: true };
    }
    throw err;
  }
}

/**
 * Atomically debit coins only if the user has sufficient balance.
 * Prevents race-condition double withdrawals.
 */
async function debitCoinsForCashout({
  userId,
  amount,
  referenceId,
  metadata = null,
  extraSet = {},
}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Debit amount must be a positive integer');
  }

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      isBanned: false,
      pointsBalance: { $gte: amount },
    },
    {
      $inc: { pointsBalance: -amount },
      $set: extraSet,
    },
    { new: true }
  );

  if (!updatedUser) {
    return null; // Insufficient balance or banned
  }

  const transaction = await CoinTransaction.create({
    userId,
    type: 'cashout_deduction',
    amount: -amount,
    balanceAfter: updatedUser.pointsBalance,
    referenceId,
    metadata,
  });

  return { user: updatedUser, transaction };
}

/**
 * Atomically refund coins if an external payout gateway fails.
 * Guarantees zero missing coins on gateway errors.
 */
async function refundCashout({
  userId,
  amount,
  referenceId,
  previousCashoutDate = null,
  metadata = null,
}) {
  return await creditCoins({
    userId,
    type: 'cashout_refund',
    amount,
    referenceId,
    metadata,
    extraSet: { lastCashoutDate: previousCashoutDate },
  });
}

module.exports = {
  creditCoins,
  debitCoinsForCashout,
  refundCashout,
};
