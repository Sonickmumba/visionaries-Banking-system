const {
  getAllMembers,
  getMemberById,
  addMember,
  updateMember,
  getMemberBalance,
  getMemberTransactions
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

module.exports = {
  getAllMembers:         getAllMembersHandler,
  getMemberById:        getMemberByIdHandler,
  getMemberBalance:     getMemberBalanceHandler,
  getMemberTransactions: getMemberTransactionsHandler,
  addMember:            addMemberHandler,
  updateMember:         updateMemberHandler
};
