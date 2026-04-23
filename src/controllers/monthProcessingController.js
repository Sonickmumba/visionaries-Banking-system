const {
  processMonthEnd,
  getMonthEndSummary,
  rollbackMonth
} = require('../models/monthlyProcessingsModel');

const PROCESSING_ERRORS = {
  'Cycle not found':                        [404, 'Cycle not found'],
  'No active cycle':                        [400, 'No active cycle found'],
  'Month already processed':                [400, 'Month has already been processed'],
  'Cannot advance beyond cycle end date':   [400, 'Cannot advance beyond cycle end date — the cycle has reached its final month'],
  'Cannot rollback from month 1':           [400, 'Cannot rollback — already at month 1'],
  'Cannot rollback: already at month 1':    [400, 'Cannot rollback — already at month 1'],
};

function handleProcessingError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = PROCESSING_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ success: false, error: mapped[1] });
  res.status(500).json({ success: false, error: `Failed to ${context}` });
}

// GET /api/cycles/:cycleId/month-processing/summary?month=N
async function getMonthEndSummaryHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = parseInt(req.query.month, 10);
    if (!req.query.month || isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    }

    const summary = await getMonthEndSummary(cycleId, month);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

// POST /api/cycles/:cycleId/month-processing/process
async function processMonthEndHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const result = await processMonthEnd(cycleId);
    res.json({
      success: true,
      message: 'Month-end processing completed successfully',
      data: result
    });
  } catch (error) {
    handleProcessingError(res, error, 'process month-end');
  }
}

// POST /api/cycles/:cycleId/month-processing/rollback
async function rollbackMonthHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const result = await rollbackMonth(cycleId);
    res.json({
      success: true,
      message: 'Month rollback completed successfully',
      data: result
    });
  } catch (error) {
    handleProcessingError(res, error, 'rollback month');
  }
}

module.exports = {
  getMonthEndSummary: getMonthEndSummaryHandler,
  processMonthEnd:    processMonthEndHandler,
  rollbackMonth:      rollbackMonthHandler
};
