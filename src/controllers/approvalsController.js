const {
  getApprovals,
  getApprovalById,
  getApprovalStats,
  approveSavingsDeclaration,
  rejectSavingsDeclaration,
  approveLoanRequest,
  rejectLoanRequest,
  approveLoanRepayment,
  rejectLoanRepayment
} = require('../models/approvalsModel');

// Roles that are allowed to review (approve/reject) approvals
const REVIEWER_ROLES = ['admin', 'super_admin'];

// Map known model error messages to HTTP responses
function handleApprovalError(res, error, context) {
  console.error(`Error in ${context}:`, error);

  const knownErrors = {
    'Approval not found':      [404, 'Approval not found'],
    'Approval already processed': [400, 'Approval already processed']
  };

  const mapped = knownErrors[error.message];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });

  res.status(500).json({ error: `Failed to ${context}` });
}

// GET /api/approvals
async function getApprovalsHandler(req, res) {
  try {
    const { cycleId, type, status, limit, offset } = req.query;

    const parsedLimit  = limit  ? parseInt(limit, 10)  : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    if (limit  && isNaN(parsedLimit))  return res.status(400).json({ error: 'limit must be a number' });
    if (offset && isNaN(parsedOffset)) return res.status(400).json({ error: 'offset must be a number' });

    const filters = {
      cycleId: cycleId ? parseInt(cycleId, 10) : null,
      type,
      status,
      limit:  parsedLimit,
      offset: parsedOffset
    };

    const approvals = await getApprovals(filters);

    res.json({
      approvals,
      pagination: { limit: filters.limit, offset: filters.offset, count: approvals.length }
    });
  } catch (error) {
    handleApprovalError(res, error, 'fetch approvals');
  }
}

// GET /api/approvals/stats
async function getApprovalStatsHandler(req, res) {
  try {
    const { cycleId } = req.query;

    if (!cycleId) return res.status(400).json({ error: 'cycleId is required' });

    const parsed = parseInt(cycleId, 10);
    if (isNaN(parsed)) return res.status(400).json({ error: 'cycleId must be a number' });

    const stats = await getApprovalStats(parsed);
    res.json(stats);
  } catch (error) {
    handleApprovalError(res, error, 'fetch approval statistics');
  }
}

// GET /api/approvals/:id
async function getApprovalByIdHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    const approval = await getApprovalById(id);
    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    res.json(approval);
  } catch (error) {
    handleApprovalError(res, error, 'fetch approval');
  }
}

// PATCH /api/approvals/savings/:id/approve
async function approveSavingsDeclarationHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to approve declarations' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    await approveSavingsDeclaration(id, req.user.id);
    res.json({ message: 'Savings declaration approved successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'approve savings declaration');
  }
}

// PATCH /api/approvals/savings/:id/reject
async function rejectSavingsDeclarationHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to reject declarations' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    await rejectSavingsDeclaration(id, req.user.id, reason.trim());
    res.json({ message: 'Savings declaration rejected successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'reject savings declaration');
  }
}

// PATCH /api/approvals/repayments/:id/approve
async function approveLoanRepaymentHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to approve repayments' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    await approveLoanRepayment(id, req.user.id);
    res.json({ message: 'Loan repayment approved successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'approve loan repayment');
  }
}

// PATCH /api/approvals/repayments/:id/reject
async function rejectLoanRepaymentHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to reject repayments' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    await rejectLoanRepayment(id, req.user.id, reason.trim());
    res.json({ message: 'Loan repayment rejected successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'reject loan repayment');
  }
}

// PATCH /api/approvals/loan-requests/:id/approve
async function approveLoanRequestHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to approve loan requests' });
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    await approveLoanRequest(id, req.user.id);
    res.json({ message: 'Loan request approved successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'approve loan request');
  }
}

// PATCH /api/approvals/loan-requests/:id/reject
async function rejectLoanRequestHandler(req, res) {
  try {
    if (!REVIEWER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions to reject loan requests' });
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid approval ID' });

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    await rejectLoanRequest(id, req.user.id, reason.trim());
    res.json({ message: 'Loan request rejected successfully' });
  } catch (error) {
    handleApprovalError(res, error, 'reject loan request');
  }
}

module.exports = {
  getApprovals:                 getApprovalsHandler,
  getApprovalById:              getApprovalByIdHandler,
  getApprovalStats:             getApprovalStatsHandler,
  approveSavingsDeclaration:    approveSavingsDeclarationHandler,
  rejectSavingsDeclaration:     rejectSavingsDeclarationHandler,
  approveLoanRequest:           approveLoanRequestHandler,
  rejectLoanRequest:            rejectLoanRequestHandler,
  approveLoanRepayment:         approveLoanRepaymentHandler,
  rejectLoanRepayment:          rejectLoanRepaymentHandler
};
