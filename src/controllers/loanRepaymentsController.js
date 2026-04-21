const {
  referenceNumberExists,
  createRepayment,
  getRepaymentsByLoan,
  getRepaymentById,
  getRepaymentsByMember,
  getRepaymentsByCycle,
  generateReferenceNumber
} = require('../models/loanRepaymentsModel');

const VALID_PAYMENT_METHODS = ['mobile_money', 'cash', 'bank_transfer'];

const REPAYMENT_ERRORS = {
  'Loan not found':                           [404, 'Loan not found'],
  'Loan is already fully repaid':             [400, 'Loan is already fully repaid'],
  'Repayment amount exceeds outstanding balance': [400, 'Repayment amount exceeds outstanding balance']
};

function handleRepaymentError(res, error, context) {
  console.error(`Error in ${context}:`, error);
  const mapped = REPAYMENT_ERRORS[error.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  res.status(500).json({ error: `Failed to ${context}` });
}

// POST /api/loans/:loanId/repayments
async function createRepaymentHandler(req, res, next) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    if (isNaN(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });

    const { amount, paymentMethod, paymentProofId, referenceNumber } = req.body;

    if (!amount || !paymentMethod || !paymentProofId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['amount', 'paymentMethod', 'paymentProofId']
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a number greater than 0' });
    }

    if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Invalid payment method', validMethods: VALID_PAYMENT_METHODS });
    }

    if (referenceNumber) {
      const exists = await referenceNumberExists(referenceNumber);
      if (exists) return res.status(400).json({ error: 'Reference number already exists' });
    }

    const repayment = await createRepayment(
      loanId, parsedAmount, paymentMethod, paymentProofId, referenceNumber, req.user.userId
    );

    res.status(201).json({ message: 'Loan repayment submitted for approval', repayment });
  } catch (error) {
    handleRepaymentError(res, error, 'create loan repayment');
  }
}

// GET /api/loans/:loanId/repayments
async function getRepaymentsByLoanHandler(req, res, next) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    if (isNaN(loanId)) return res.status(400).json({ error: 'Invalid loan ID' });

    const repayments = await getRepaymentsByLoan(loanId);
    res.json({ repayments });
  } catch (error) {
    next(error);
  }
}

// GET /api/repayments/:id
async function getRepaymentByIdHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid repayment ID' });

    const repayment = await getRepaymentById(id);
    if (!repayment) return res.status(404).json({ error: 'Repayment not found' });

    res.json(repayment);
  } catch (error) {
    next(error);
  }
}

// GET /api/members/:memberId/repayments?cycleId=N
async function getRepaymentsByMemberHandler(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (isNaN(memberId)) return res.status(400).json({ error: 'Invalid member ID' });

    const cycleId = parseInt(req.query.cycleId, 10);
    if (!req.query.cycleId || isNaN(cycleId)) {
      return res.status(400).json({ error: 'cycleId is required and must be a number' });
    }

    const repayments = await getRepaymentsByMember(memberId, cycleId);
    res.json({ repayments });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/:cycleId/repayments?status=...
async function getRepaymentsByCycleHandler(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ error: 'Invalid cycle ID' });

    const { status } = req.query;
    const repayments = await getRepaymentsByCycle(cycleId, status);
    res.json({ repayments });
  } catch (error) {
    next(error);
  }
}

// GET /api/repayments/generate-reference
async function generateReference(req, res, next) {
  try {
    const referenceNumber = await generateReferenceNumber();
    res.json({ referenceNumber });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createRepayment:        createRepaymentHandler,
  getRepaymentsByLoan:    getRepaymentsByLoanHandler,
  getRepaymentById:       getRepaymentByIdHandler,
  getRepaymentsByMember:  getRepaymentsByMemberHandler,
  getRepaymentsByCycle:   getRepaymentsByCycleHandler,
  generateReference
};
