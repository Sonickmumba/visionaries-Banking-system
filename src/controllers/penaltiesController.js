const {
  getPenaltiesByCycle:            getPenaltiesByCycleModel,
  getPenaltyById:                 getPenaltyByIdModel,
  assessPenalty:                  assessPenaltyModel,
  updatePenaltyStatus:            updatePenaltyStatusModel,
  getPenaltiesStats:              getPenaltiesStatsModel,
  assessFailureToDeclarePenalties: assessFailureToDeclarePenaltiesModel
} = require('../models/penaltiesModel');

// const VALID_PENALTY_STATUSES = ['pending', 'paid', 'waived'];
const VALID_PENALTY_STATUSES = ['assessed', 'paid', 'waived', 'converted_to_loan'];  

const VALID_PENALTY_TYPES    = ['failure_to_declare', 'late_payment', 'other'];

const PENALTY_ERRORS = {
  'Penalty not found':   [404, 'Penalty not found'],
  'Member not found':    [404, 'Member not found'],
  'Cycle not found':     [404, 'Cycle not found']
};

function handlePenaltyError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = PENALTY_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ success: false, error: mapped[1] });
  res.status(500).json({ success: false, error: `Failed to ${context}` });
}

// GET /api/cycles/:cycleId/penalties?month=N&status=...&memberId=N
async function getPenaltiesByCycle(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = req.query.month ? parseInt(req.query.month, 10) : undefined;
    if (req.query.month && isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month must be a number' });
    }

    const memberId = req.query.memberId ? parseInt(req.query.memberId, 10) : undefined;
    if (req.query.memberId && isNaN(memberId)) {
      return res.status(400).json({ success: false, error: 'memberId must be a number' });
    }

    const penalties = await getPenaltiesByCycleModel(cycleId, month, req.query.status, memberId);
    res.json({ success: true, data: penalties, count: penalties.length });
  } catch (error) {
    next(error);
  }
}

// GET /api/penalties/:id
async function getPenaltyById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid penalty ID' });

    const penalty = await getPenaltyByIdModel(id);
    if (!penalty) return res.status(404).json({ success: false, error: 'Penalty not found' });

    res.json({ success: true, data: penalty });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/:cycleId/penalties/stats?month=N
async function getPenaltiesStats(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = req.query.month ? parseInt(req.query.month, 10) : undefined;
    if (req.query.month && isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month must be a number' });
    }

    const stats = await getPenaltiesStatsModel(cycleId, month);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

// POST /api/penalties
async function assessPenalty(req, res, next) {
  try {
    const { member_id, cycle_id, month, penalty_type, amount, reason } = req.body;

    if (!member_id || !cycle_id || !month || !penalty_type || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['member_id', 'cycle_id', 'month', 'penalty_type', 'amount']
      });
    }

    if (!VALID_PENALTY_TYPES.includes(penalty_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid penalty_type',
        validTypes: VALID_PENALTY_TYPES
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a number greater than 0' });
    }

    const penalty = await assessPenaltyModel({
      member_id:    parseInt(member_id, 10),
      cycle_id:     parseInt(cycle_id, 10),
      month:        parseInt(month, 10),
      penalty_type,
      amount:       parsedAmount,
      reason
    });

    res.status(201).json({ success: true, message: 'Penalty assessed successfully', data: penalty });
  } catch (error) {
    handlePenaltyError(res, error, 'assess penalty');
  }
}

// PATCH /api/penalties/:id/status
async function updatePenaltyStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid penalty ID' });

    const { status } = req.body;
    if (!status || !VALID_PENALTY_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${VALID_PENALTY_STATUSES.join(', ')}`
      });
    }

    const penalty = await updatePenaltyStatusModel(id, status);
    if (!penalty) return res.status(404).json({ success: false, error: 'Penalty not found' });

    res.json({ success: true, message: 'Penalty status updated successfully', data: penalty });
  } catch (error) {
    handlePenaltyError(res, error, 'update penalty status');
  }
}

// POST /api/cycles/:cycleId/penalties/assess-failure
async function assessFailureToDeclarePenalties(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = parseInt(req.body.month, 10);
    if (!req.body.month || isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    }

    const result = await assessFailureToDeclarePenaltiesModel(cycleId, month);
    res.json({
      success: true,
      message: `Assessed ${result.penaltiesAssessed} failure to declare penalties`,
      data: result
    });
  } catch (error) {
    handlePenaltyError(res, error, 'assess failure to declare penalties');
  }
}

module.exports = {
  getPenaltiesByCycle,
  getPenaltyById,
  getPenaltiesStats,
  assessPenalty,
  updatePenaltyStatus,
  assessFailureToDeclarePenalties
};
