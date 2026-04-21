const {
  analyzeBorrowingPatterns: analyzePatternsModel,
  calculateAllocations,
  applyAllocations:         applyAllocationsModel,
  getAllocations:            getAllocationsModel
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

module.exports = {
  analyzeBorrowingPatterns,
  previewAllocations,
  applyAllocations,
  getAllocations
};
