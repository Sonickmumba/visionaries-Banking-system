const {
  analyzeBorrowingPatterns: analyzePatternsModel,
  calculateAllocations,
  applyAllocations:              applyAllocationsModel,
  getAllocations:                 getAllocationsModel,
  payCommonInterest:             payCommonInterestModel,
  enforceUnpaidCommonInterest:   enforceUnpaidCommonInterestModel,
} = require('../models/commonInterestModel');

// GET /api/cycles/:cycleId/common-interest/analyze?month=N
async function analyzeBorrowingPatterns(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    const month   = parseInt(req.query.month, 10);

    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });
    if (!req.query.month || isNaN(month)) return res.status(400).json({ success: false, error: 'month is required and must be a number' });

    const analysis = await analyzePatternsModel(cycleId, month);
    res.json({ success: true, data: analysis });
  } catch (error) {
    next(error);
  }
}

// POST /api/cycles/:cycleId/common-interest/preview
async function previewAllocations(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });

    const { month, allocationMethod } = req.body;
    const parsedMonth = parseInt(month, 10);

    if (!month || isNaN(parsedMonth)) return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    if (!allocationMethod)            return res.status(400).json({ success: false, error: 'allocationMethod is required' });

    const preview = await calculateAllocations(cycleId, parsedMonth, allocationMethod);
    res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
}

// POST /api/cycles/:cycleId/common-interest/apply
async function applyAllocations(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });

    const { month, allocationMethod } = req.body;
    const parsedMonth = parseInt(month, 10);

    if (!month || isNaN(parsedMonth)) return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    if (!allocationMethod)            return res.status(400).json({ success: false, error: 'allocationMethod is required' });

    const result = await applyAllocationsModel(cycleId, parsedMonth, allocationMethod);
    res.json({
      success: true,
      message: 'Common interest allocations applied successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/:cycleId/common-interest?month=N
async function getAllocations(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    const month   = parseInt(req.query.month, 10);

    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });
    if (!req.query.month || isNaN(month)) return res.status(400).json({ success: false, error: 'month is required and must be a number' });

    const allocations = await getAllocationsModel(cycleId, month);
    res.json({ success: true, data: allocations, count: allocations.length });
  } catch (error) {
    next(error);
  }
}

// POST /api/common-interest/cycle/:cycleId/pay
async function payCommonInterest(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });

    const { member_id, month, amount, payment_date } = req.body;
    const parsedMonth  = parseInt(month, 10);
    const parsedAmount = parseFloat(amount);

    if (!member_id || isNaN(parseInt(member_id, 10))) return res.status(400).json({ success: false, error: 'member_id is required' });
    if (!month || isNaN(parsedMonth))    return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    if (!payment_date || isNaN(Date.parse(payment_date))) return res.status(400).json({ success: false, error: 'payment_date must be a valid date' });

    const result = await payCommonInterestModel(
      cycleId, parseInt(member_id, 10), parsedMonth, parsedAmount, payment_date
    );
    res.json({ success: true, message: 'Common interest payment recorded', data: result });
  } catch (error) {
    if (error.message.includes('exceeds amount due') ||
        error.message.includes('No common interest allocation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
}

// POST /api/common-interest/cycle/:cycleId/enforce
async function enforceUnpaidCommonInterest(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycleId' });

    const { month } = req.body;
    const parsedMonth = parseInt(month, 10);
    if (!month || isNaN(parsedMonth)) return res.status(400).json({ success: false, error: 'month is required and must be a number' });

    const result = await enforceUnpaidCommonInterestModel(cycleId, parsedMonth);
    res.json({
      success: true,
      message: `${result.converted} member(s) had unpaid common interest converted to loans`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  analyzeBorrowingPatterns,
  previewAllocations,
  applyAllocations,
  getAllocations,
  payCommonInterest,
  enforceUnpaidCommonInterest,
};
