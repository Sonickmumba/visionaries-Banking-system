const {
  getCycleReport:          getCycleReportModel,
  getMemberStatement:      getMemberStatementModel,
  getComplianceReport:     getComplianceReportModel,
  getSavingsGrowthReport:  getSavingsGrowthReportModel,
  getLoanPortfolioReport:  getLoanPortfolioReportModel
} = require('../models/reportsModel');

const REPORT_ERRORS = {
  'Cycle not found':  [404, 'Cycle not found'],
  'Member not found': [404, 'Member not found']
};

function handleReportError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = REPORT_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ success: false, error: mapped[1] });
  res.status(500).json({ success: false, error: `Failed to ${context}` });
}

// GET /api/cycles/:cycleId/reports/cycle?month=N
async function getCycleReport(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    if (req.query.month && isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month must be a number' });
    }

    const report = await getCycleReportModel(cycleId, month);
    res.json({ success: true, data: report });
  } catch (error) {
    handleReportError(res, error, 'get cycle report');
  }
}

// GET /api/cycles/:cycleId/reports/member/:memberId
async function getMemberStatement(req, res, next) {
  try {
    const cycleId  = parseInt(req.params.cycleId, 10);
    const memberId = parseInt(req.params.memberId, 10);

    if (isNaN(cycleId))  return res.status(400).json({ success: false, error: 'Invalid cycle ID' });
    if (isNaN(memberId)) return res.status(400).json({ success: false, error: 'Invalid member ID' });

    const statement = await getMemberStatementModel(memberId, cycleId);
    res.json({ success: true, data: statement });
  } catch (error) {
    handleReportError(res, error, 'get member statement');
  }
}

// GET /api/cycles/:cycleId/reports/compliance?month=N
async function getComplianceReport(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = parseInt(req.query.month, 10);
    if (!req.query.month || isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month is required and must be a number' });
    }

    const report = await getComplianceReportModel(cycleId, month);
    res.json({ success: true, data: report });
  } catch (error) {
    handleReportError(res, error, 'get compliance report');
  }
}

// GET /api/cycles/:cycleId/reports/savings-growth
async function getSavingsGrowthReport(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const report = await getSavingsGrowthReportModel(cycleId);
    res.json({ success: true, data: report });
  } catch (error) {
    handleReportError(res, error, 'get savings growth report');
  }
}

// GET /api/cycles/:cycleId/reports/loan-portfolio
async function getLoanPortfolioReport(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const report = await getLoanPortfolioReportModel(cycleId);
    res.json({ success: true, data: report });
  } catch (error) {
    handleReportError(res, error, 'get loan portfolio report');
  }
}

module.exports = {
  getCycleReport,
  getMemberStatement,
  getComplianceReport,
  getSavingsGrowthReport,
  getLoanPortfolioReport
};
