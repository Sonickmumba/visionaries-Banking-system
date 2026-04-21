const {
  getLoansByCycle,
  getLoanById,
  disburseLoan,
  recordLoanRepayment,
  getLoansStats
} = require('../models/loansModel');

const LOAN_ERRORS = {
  'Loan not found':                           [404, 'Loan not found'],
  'Member not found':                         [404, 'Member not found'],
  'Cycle not found':                          [404, 'Cycle not found'],
  'Loan is already fully repaid':             [400, 'Loan is already fully repaid'],
  'Repayment amount exceeds outstanding balance': [400, 'Repayment amount exceeds outstanding balance']
};

function handleLoanError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = LOAN_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  res.status(500).json({ error: `Failed to ${context}` });
}

// GET /api/loans?cycleId=N&status=...&member_id=N
async function getLoansByCycleHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const { status } = req.query;
    const memberId = req.query.member_id ? parseInt(req.query.member_id, 10) : undefined;
    if (req.query.member_id && isNaN(memberId)) {
      return res.status(400).json({ error: 'member_id must be a number' });
    }

    const loans = await getLoansByCycle(cycleId, { status, member_id: memberId });
    res.json({ loans });
  } catch (error) {
    next(error);
  }
}

// GET /api/loans/:id
async function getLoanByIdHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid loan ID' });

    const loan = await getLoanById(id);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    res.json({ loan });
  } catch (error) {
    next(error);
  }
}

// GET /api/loans/stats?cycleId=N
async function getLoansStatsHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const stats = await getLoansStats(cycleId);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
}

// POST /api/loans/disburse
async function disburseLoanHandler(req, res, next) {
  try {
    const { member_id, cycle_id, amount, loan_type } = req.body;

    if (!member_id || !cycle_id || !amount || !loan_type) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['member_id', 'cycle_id', 'amount', 'loan_type']
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a number greater than 0' });
    }

    const loan = await disburseLoan(req.body);
    res.status(201).json({ message: 'Loan disbursed successfully', loan });
  } catch (error) {
    handleLoanError(res, error, 'disburse loan');
  }
}

// POST /api/loans/:id/repayment
async function recordLoanRepaymentHandler(req, res, next) {
  try {
    const loanId = parseInt(req.params.id, 10);
    if (isNaN(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });

    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a number greater than 0' });
    }

    const result = await recordLoanRepayment({ ...req.body, loan_id: loanId });
    res.json({ message: 'Loan repayment recorded successfully', result });
  } catch (error) {
    handleLoanError(res, error, 'record loan repayment');
  }
}

module.exports = {
  getLoansByCycle:    getLoansByCycleHandler,
  getLoanById:        getLoanByIdHandler,
  getLoansStats:      getLoansStatsHandler,
  disburseLoan:       disburseLoanHandler,
  recordLoanRepayment: recordLoanRepaymentHandler
};
