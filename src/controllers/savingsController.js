const {
  getSavingsByCycle,
  getMemberSavings,
  recordSavingsDeposit,
  getSavingsStats
} = require('../models/savingsModel');

const SAVINGS_ERRORS = {
  'Cycle not found':    [404, 'Cycle not found'],
  'Member not found':   [404, 'Member not found'],
  'Deposit exceeds maximum savings cap':       [400, 'Deposit exceeds maximum savings cap'],
  'Total principal would exceed maximum savings cap': [400, 'Total principal would exceed maximum savings cap']
};

function handleSavingsError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  // partial match for dynamic cap messages
  if (error.message && error.message.includes('maximum savings cap')) {
    return res.status(400).json({ error: error.message });
  }
  const mapped = SAVINGS_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  res.status(500).json({ error: `Failed to ${context}` });
}

// GET /api/savings?cycleId=N&month=N
async function getSavingsByCycleHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.query.cycleId, 10);
    const month   = parseInt(req.query.month, 10);

    if (!req.query.cycleId || !req.query.month) {
      return res.status(400).json({ error: 'cycleId and month query parameters are required' });
    }
    if (isNaN(cycleId)) return res.status(400).json({ error: 'cycleId must be a number' });
    if (isNaN(month))   return res.status(400).json({ error: 'month must be a number' });

    const savings = await getSavingsByCycle(cycleId, month);
    res.json({ savings });
  } catch (error) {
    next(error);
  }
}

// GET /api/savings/member/:memberId?cycleId=N
async function getMemberSavingsHandler(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (isNaN(memberId)) return res.status(400).json({ error: 'Invalid member ID' });

    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const savings = await getMemberSavings(memberId, cycleId);
    res.json({ savings });
  } catch (error) {
    next(error);
  }
}

// GET /api/savings/stats?cycleId=N&month=N
async function getSavingsStatsHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.query.cycleId, 10);
    const month   = parseInt(req.query.month, 10);

    if (!req.query.cycleId || !req.query.month) {
      return res.status(400).json({ error: 'cycleId and month query parameters are required' });
    }
    if (isNaN(cycleId)) return res.status(400).json({ error: 'cycleId must be a number' });
    if (isNaN(month))   return res.status(400).json({ error: 'month must be a number' });

    const stats = await getSavingsStats(cycleId, month);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
}

// POST /api/savings/deposit
async function recordSavingsDepositHandler(req, res, next) {
  try {
    const { member_id, cycle_id, amount, date } = req.body;

    if (!member_id || !cycle_id || !amount || !date) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['member_id', 'cycle_id', 'amount', 'date']
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a number greater than 0' });
    }

    const result = await recordSavingsDeposit({ ...req.body, amount: parsedAmount });
    res.status(201).json({ message: 'Savings deposit recorded successfully', result });
  } catch (error) {
    handleSavingsError(res, error, 'record savings deposit');
  }
}

module.exports = {
  getSavingsByCycle:    getSavingsByCycleHandler,
  getMemberSavings:     getMemberSavingsHandler,
  getSavingsStats:      getSavingsStatsHandler,
  recordSavingsDeposit: recordSavingsDepositHandler
};
