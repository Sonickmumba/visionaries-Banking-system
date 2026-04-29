/**
 * Integration tests for:
 *  GET  /api/approvals/stats
 *  GET  /api/approvals
 *  GET  /api/approvals/:id
 *  PATCH /api/approvals/savings/:id/approve
 *  PATCH /api/approvals/savings/:id/reject
 *  PATCH /api/approvals/loan-requests/:id/approve
 *  PATCH /api/approvals/loan-requests/:id/reject
 *  PATCH /api/approvals/repayments/:id/approve
 *  PATCH /api/approvals/repayments/:id/reject
 *
 * The approvalsModel is fully mocked. Tests verify:
 *  - auth + admin-role enforcement
 *  - correct model delegation
 *  - 404 / 400 error mapping
 *  - correct HTTP status codes
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockDbQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: mockDbQuery,
  pool: { query: jest.fn() },
}));

const mockModel = {
  getApprovalStats:           jest.fn(),
  getApprovals:               jest.fn(),
  getApprovalById:            jest.fn(),
  createApproval:             jest.fn(),
  createApprovalWithClient:   jest.fn(),
  approveSavingsDeclaration:  jest.fn(),
  rejectSavingsDeclaration:   jest.fn(),
  approveLoanRequest:         jest.fn(),
  rejectLoanRequest:          jest.fn(),
  approveLoanRepayment:       jest.fn(),
  rejectLoanRepayment:        jest.fn(),
};

jest.mock('../../src/models/approvalsModel', () => mockModel);
jest.mock('cloudinary', () => ({ v2: { config: jest.fn() } }));
jest.mock('connect-pg-simple', () => () => class {});
jest.mock('../../src/config/passport', () => jest.fn());
jest.mock('../../src/utils/audit.util', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const approvalsRoutes = require('../../src/routes/approvals');

// ── App fixture ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(cookieParser('test-cookie-secret'));
app.use('/api/approvals', approvalsRoutes);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: err.message });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const adminUser  = { id: 1, email: 'admin@t.com', full_name: 'Admin',  role: 'admin',  status: 'active' };
const memberUser = { id: 2, email: 'member@t.com', full_name: 'Member', role: 'member', status: 'active' };

function makeToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

function authAs(user) {
  mockDbQuery.mockResolvedValue({ rows: [user] });
  return `Bearer ${makeToken(user)}`;
}

const fakeApproval = {
  id: 1, approval_type: 'savings_declaration', entity_id: 10,
  member_id: 5, cycle_id: 12, amount: 10000, status: 'pending',
  member_name: 'Alice', details: {},
};

beforeEach(() => jest.clearAllMocks());

// ─── GET /stats ───────────────────────────────────────────────────────────────

describe('GET /api/approvals/stats', () => {
  const statsPayload = {
    pending_savings: 2, pending_loan_requests: 1, pending_repayments: 0, total_pending: 3,
    approved_savings: 1, approved_loan_requests: 0, approved_repayments: 3,
    rejected_savings: 0, rejected_loan_requests: 0, rejected_repayments: 1,
  };

  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/approvals/stats?cycleId=12');
    expect(res.status).toBe(401);
  });

  test('returns 400 when cycleId is missing', async () => {
    const res = await request(app)
      .get('/api/approvals/stats')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });

  test('returns 200 with stats for authenticated user', async () => {
    mockModel.getApprovalStats.mockResolvedValueOnce(statsPayload);
    const res = await request(app)
      .get('/api/approvals/stats?cycleId=12')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(200);
    expect(res.body.total_pending).toBe(3);
    expect(mockModel.getApprovalStats).toHaveBeenCalledWith(12);
  });

  test('returns 200 for member role (stats are readable by all authenticated users)', async () => {
    mockModel.getApprovalStats.mockResolvedValueOnce(statsPayload);
    const res = await request(app)
      .get('/api/approvals/stats?cycleId=12')
      .set('Authorization', authAs(memberUser));
    expect(res.status).toBe(200);
  });
});

// ─── GET / (list approvals) ───────────────────────────────────────────────────

describe('GET /api/approvals', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/approvals');
    expect(res.status).toBe(401);
  });

  test('returns paginated approval list', async () => {
    mockModel.getApprovals.mockResolvedValueOnce([fakeApproval, fakeApproval]);
    const res = await request(app)
      .get('/api/approvals?cycleId=12&status=pending')
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('count', 2);
  });

  test('passes type and status filters to model', async () => {
    mockModel.getApprovals.mockResolvedValueOnce([]);
    await request(app)
      .get('/api/approvals?cycleId=12&type=savings_declaration&status=pending')
      .set('Authorization', authAs(adminUser));

    const [filters] = mockModel.getApprovals.mock.calls[0];
    expect(filters.type).toBe('savings_declaration');
    expect(filters.status).toBe('pending');
    expect(filters.cycleId).toBe(12);
  });

  test('returns 400 for non-numeric limit', async () => {
    const res = await request(app)
      .get('/api/approvals?limit=abc')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /api/approvals/:id', () => {
  test('returns 200 with approval details', async () => {
    mockModel.getApprovalById.mockResolvedValueOnce(fakeApproval);
    const res = await request(app)
      .get('/api/approvals/1')
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    // controller returns the approval object directly (no wrapper key)
    expect(res.body).toHaveProperty('id', 1);
  });

  test('returns 404 when approval does not exist', async () => {
    mockModel.getApprovalById.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/approvals/999')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /savings/:id/approve ───────────────────────────────────────────────

describe('PATCH /api/approvals/savings/:id/approve', () => {
  test('returns 403 for member role', async () => {
    const res = await request(app)
      .patch('/api/approvals/savings/1/approve')
      .set('Authorization', authAs(memberUser));
    expect(res.status).toBe(403);
  });

  test('returns 200 on successful approval', async () => {
    mockModel.approveSavingsDeclaration.mockResolvedValueOnce({
      approvalId: 1, declarationId: 10, savingsId: 7,
    });
    const res = await request(app)
      .patch('/api/approvals/savings/1/approve')
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(mockModel.approveSavingsDeclaration).toHaveBeenCalledWith(1, adminUser.id);
  });

  test('returns 404 when model throws Approval not found', async () => {
    mockModel.approveSavingsDeclaration.mockRejectedValueOnce(new Error('Approval not found'));
    const res = await request(app)
      .patch('/api/approvals/savings/999/approve')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(404);
  });

  test('returns 400 when model throws Approval already processed', async () => {
    mockModel.approveSavingsDeclaration.mockRejectedValueOnce(new Error('Approval already processed'));
    const res = await request(app)
      .patch('/api/approvals/savings/1/approve')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /savings/:id/reject ────────────────────────────────────────────────

describe('PATCH /api/approvals/savings/:id/reject', () => {
  test('returns 403 for member role', async () => {
    const res = await request(app)
      .patch('/api/approvals/savings/1/reject')
      .send({ reason: 'Invalid payment' })
      .set('Authorization', authAs(memberUser));
    expect(res.status).toBe(403);
  });

  test('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .patch('/api/approvals/savings/1/reject')
      .send({})
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });

  test('returns 200 on successful rejection', async () => {
    mockModel.rejectSavingsDeclaration.mockResolvedValueOnce({ approvalId: 1 });
    const res = await request(app)
      .patch('/api/approvals/savings/1/reject')
      .send({ reason: 'Blurry photo' })
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(mockModel.rejectSavingsDeclaration).toHaveBeenCalledWith(1, adminUser.id, 'Blurry photo');
  });
});

// ─── PATCH /loan-requests/:id/approve ────────────────────────────────────────

describe('PATCH /api/approvals/loan-requests/:id/approve', () => {
  test('returns 403 for member role', async () => {
    const res = await request(app)
      .patch('/api/approvals/loan-requests/1/approve')
      .set('Authorization', authAs(memberUser));
    expect(res.status).toBe(403);
  });

  test('returns 200 on successful loan approval', async () => {
    mockModel.approveLoanRequest.mockResolvedValueOnce({
      approvalId: 1, loanId: 99, memberId: 5,
    });
    const res = await request(app)
      .patch('/api/approvals/loan-requests/1/approve')
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(mockModel.approveLoanRequest).toHaveBeenCalledWith(1, adminUser.id);
  });

  test('returns 404 when loan request approval not found', async () => {
    mockModel.approveLoanRequest.mockRejectedValueOnce(new Error('Approval not found'));
    const res = await request(app)
      .patch('/api/approvals/loan-requests/999/approve')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /loan-requests/:id/reject ─────────────────────────────────────────

describe('PATCH /api/approvals/loan-requests/:id/reject', () => {
  test('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .patch('/api/approvals/loan-requests/1/reject')
      .send({})
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });

  test('returns 200 on successful rejection', async () => {
    mockModel.rejectLoanRequest.mockResolvedValueOnce({ approvalId: 1 });
    const res = await request(app)
      .patch('/api/approvals/loan-requests/1/reject')
      .send({ reason: 'Insufficient collateral' })
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(mockModel.rejectLoanRequest).toHaveBeenCalledWith(1, adminUser.id, 'Insufficient collateral');
  });
});

// ─── PATCH /repayments/:id/approve ───────────────────────────────────────────

describe('PATCH /api/approvals/repayments/:id/approve', () => {
  test('returns 403 for member role', async () => {
    const res = await request(app)
      .patch('/api/approvals/repayments/1/approve')
      .set('Authorization', authAs(memberUser));
    expect(res.status).toBe(403);
  });

  test('returns 200 on successful repayment approval', async () => {
    mockModel.approveLoanRepayment.mockResolvedValueOnce({
      approvalId: 1, repaymentId: 50, loanId: 99,
    });
    const res = await request(app)
      .patch('/api/approvals/repayments/1/approve')
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(mockModel.approveLoanRepayment).toHaveBeenCalledWith(1, adminUser.id);
  });

  test('returns 404 when repayment approval not found', async () => {
    mockModel.approveLoanRepayment.mockRejectedValueOnce(new Error('Approval not found'));
    const res = await request(app)
      .patch('/api/approvals/repayments/999/approve')
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /repayments/:id/reject ────────────────────────────────────────────

describe('PATCH /api/approvals/repayments/:id/reject', () => {
  test('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .patch('/api/approvals/repayments/1/reject')
      .send({})
      .set('Authorization', authAs(adminUser));
    expect(res.status).toBe(400);
  });

  test('returns 200 on successful repayment rejection', async () => {
    mockModel.rejectLoanRepayment.mockResolvedValueOnce({ approvalId: 1 });
    const res = await request(app)
      .patch('/api/approvals/repayments/1/reject')
      .send({ reason: 'Payment not received' })
      .set('Authorization', authAs(adminUser));

    expect(res.status).toBe(200);
    expect(mockModel.rejectLoanRepayment).toHaveBeenCalledWith(1, adminUser.id, 'Payment not received');
  });
});
