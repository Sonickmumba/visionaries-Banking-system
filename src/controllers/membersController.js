const {
  getAllMembers,
  getMemberById,
  addMember,
  enrollMember,
  updateMember,
  getMemberBalance,
  getMemberTransactions,
  getPendingUsers,
  approveAndEnroll,
  recordFeePayment,
} = require('../models/membersModel');

const MEMBER_ERRORS = {
  'Member not found': [404, 'Member not found'],
  'Cycle not found':  [404, 'Cycle not found'],
  'User not found':   [404, 'User not found'],
  'Member already exists in this cycle': [409, 'Member already exists in this cycle']
};

function handleMemberError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = MEMBER_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  res.status(500).json({ error: `Failed to ${context}` });
}

// GET /api/members?cycleId=N&status=...
async function getAllMembersHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const { status } = req.query;
    const members = await getAllMembers(cycleId, { status });
    res.json({ members });
  } catch (error) {
    next(error);
  }
}

// GET /api/members/:id
async function getMemberByIdHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid member ID' });

    const member = await getMemberById(id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    res.json({ member });
  } catch (error) {
    next(error);
  }
}

// GET /api/members/:id/balance?month=N
async function getMemberBalanceHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid member ID' });

    const month = parseInt(req.query.month, 10);
    if (!req.query.month || isNaN(month)) {
      return res.status(400).json({ error: 'month is required and must be a number' });
    }

    const balance = await getMemberBalance(id, month);
    if (!balance) return res.status(404).json({ error: 'Balance not found for this month' });

    res.json({ balance });
  } catch (error) {
    next(error);
  }
}

// GET /api/members/:id/transactions?cycleId=N&month=N&type=...&limit=N
async function getMemberTransactionsHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid member ID' });

    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const month = req.query.month ? parseInt(req.query.month, 10) : undefined;
    if (req.query.month && isNaN(month)) {
      return res.status(400).json({ error: 'month must be a number' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    if (req.query.limit && isNaN(limit)) {
      return res.status(400).json({ error: 'limit must be a number' });
    }

    const transactions = await getMemberTransactions(id, cycleId, { month, type: req.query.type, limit });
    res.json({ transactions });
  } catch (error) {
    next(error);
  }
}

// POST /api/members
async function addMemberHandler(req, res, next) {
  try {
    const { user_id, cycle_id } = req.body;
    if (!user_id || !cycle_id) {
      return res.status(400).json({ error: 'Missing required fields', required: ['user_id', 'cycle_id'] });
    }

    const member = await addMember(req.body);
    res.status(201).json({ message: 'Member added successfully', member });
  } catch (error) {
    handleMemberError(res, error, 'add member');
  }
}

// PATCH /api/members/:id
async function updateMemberHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid member ID' });

    const member = await updateMember(id, req.body);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    res.json({ message: 'Member updated successfully', member });
  } catch (error) {
    handleMemberError(res, error, 'update member');
  }
}

// POST /api/members/enroll
// Accepts { full_name, email, phone, address, cycle_id, joined_date }
// Creates user (if new) + member atomically.
async function enrollMemberHandler(req, res, next) {
  try {
    const { full_name, email, phone, address, cycle_id, joined_date } = req.body;
    if (!full_name || !email || !cycle_id || !joined_date) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['full_name', 'email', 'cycle_id', 'joined_date'],
      });
    }
    const { temporaryPassword, ...member } = await enrollMember({ full_name, email, phone, address, cycle_id, joined_date });
    res.status(201).json({
      message: 'Member enrolled successfully',
      member,
      // Only present when a brand-new user account was created.
      // Show this once to the admin so they can pass it to the member.
      ...(temporaryPassword ? { temporaryPassword } : {}),
    });
  } catch (error) {
    handleMemberError(res, error, 'enroll member');
  }
}

// GET /api/members/pending  (admin only)
// Returns users with role=member and status=pending — awaiting enrollment approval.
async function getPendingMembersHandler(req, res, next) {
  try {
    const users = await getPendingUsers();
    res.json({ pendingUsers: users });
  } catch (error) {
    next(error);
  }
}

// POST /api/members/:userId/approve  (admin only)
// Approves a pending user and enrolls them into the given cycle.
async function approveMemberHandler(req, res, next) {
  try {
    const user_id = parseInt(req.params.userId, 10);
    if (isNaN(user_id)) return res.status(400).json({ error: 'Invalid user ID' });

    const { cycle_id, joined_date } = req.body;
    if (!cycle_id || !joined_date) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['cycle_id', 'joined_date'],
      });
    }

    const member = await approveAndEnroll({ user_id, cycle_id: parseInt(cycle_id, 10), joined_date });
    res.status(201).json({ message: 'Member approved and enrolled successfully', member });
  } catch (error) {
    handleMemberError(res, error, 'approve member');
  }
}

// PATCH /api/members/:id/fees  (admin only)
// Body: { cycleId, feeType: 'social_fund' | 'membership_fee', paymentDate }
async function recordFeePaymentHandler(req, res, next) {
  try {
    const memberId = parseInt(req.params.id, 10);
    if (isNaN(memberId)) return res.status(400).json({ error: 'Invalid member ID' });

    const { cycleId, feeType, paymentDate } = req.body;
    if (!cycleId || !feeType || !paymentDate) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['cycleId', 'feeType', 'paymentDate'],
      });
    }
    if (!['social_fund', 'membership_fee'].includes(feeType)) {
      return res.status(400).json({ error: 'feeType must be social_fund or membership_fee' });
    }

    const result = await recordFeePayment(memberId, parseInt(cycleId, 10), feeType, paymentDate);
    res.json({ message: 'Fee payment recorded successfully', ...result });
  } catch (error) {
    const FEE_ERRORS = {
      'Member not found in cycle':                             [404, 'Member not found in cycle'],
      'Cycle not found':                                       [404, 'Cycle not found'],
      'Fee payments can only be recorded in month 1 of the cycle': [400, 'Fee payments can only be recorded in month 1 of the cycle'],
      'Monthly balance record not found for month 1':          [404, 'Monthly balance record not found for month 1'],
      'Fee already recorded as paid':                          [409, 'Fee already recorded as paid'],
    };
    const mapped = FEE_ERRORS[error.message];
    if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
    next(error);
  }
}

module.exports = {
  getAllMembers:          getAllMembersHandler,
  getMemberById:         getMemberByIdHandler,
  getMemberBalance:      getMemberBalanceHandler,
  getMemberTransactions: getMemberTransactionsHandler,
  addMember:             addMemberHandler,
  enrollMember:          enrollMemberHandler,
  updateMember:          updateMemberHandler,
  getPendingMembers:     getPendingMembersHandler,
  approveMember:         approveMemberHandler,
  recordFeePayment:      recordFeePaymentHandler,
};

