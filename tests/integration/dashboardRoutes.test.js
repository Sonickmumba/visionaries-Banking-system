/**
 * Integration tests for GET /api/dashboard/cycle/:cycleId
 *
 * The dashboardModel is fully mocked so no real DB is needed.
 * Tests verify:
 *  - auth middleware enforcement
 *  - invalid cycleId / month param validation
 *  - 404 pass-through when cycle not found
 *  - 200 shape when model resolves
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// ── Mock DB (needed by auth middleware) ──────────────────────────────────────
const mockDbQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: mockDbQuery,
  pool: { query: jest.fn() },
}));

// ── Mock the dashboard model ─────────────────────────────────────────────────
const mockGetDashboardData = jest.fn();
jest.mock('../../src/models/dashboardModel', () => ({
  getDashboardData: mockGetDashboardData,
}));

jest.mock('cloudinary', () => ({ v2: { config: jest.fn() } }));
jest.mock('connect-pg-simple', () => () => class {});
jest.mock('../../src/config/passport', () => jest.fn());
jest.mock('../../src/utils/audit.util', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const dashboardRoutes = require('../../src/routes/dashboardRoutes');

// ── App fixture ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cookieParser('test-cookie-secret'));
app.use('/api/dashboard', dashboardRoutes);

// Error handler (mirrors app.js behaviour)
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ success: false, error: err.message });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const adminUser = {
  id: 1, email: 'admin@test.com', full_name: 'Admin',
  role: 'admin', status: 'active',
};

function makeToken(user = adminUser) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

const fakeDashboardData = {
  cycle: { id: 12, name: 'Cycle 2026', currentMonth: 3, status: 'active' },
  month: 3,
  stats: {
    totalMembers: 3, activeMembers: 3,
    totalSavingsPrincipal: 35000, pool: 35000,
    unborrowed: 0, netCashLentOut: 35000,
    totalDisbursedPrincipal: 35000, totalRepaidPrincipal: 0,
    interestRate: 0.15,
  },
  monthlyBalances: [],
  declarations: { submitted: 2, processed: 1, pending: 0, missing: 1 },
  recentLoans: [],
  recentDeclarations: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticate middleware resolves user from DB
  mockDbQuery.mockResolvedValue({ rows: [adminUser] });
  mockGetDashboardData.mockResolvedValue(fakeDashboardData);
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/cycle/:cycleId', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const res = await request(app).get('/api/dashboard/cycle/12');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', 'Bearer not.a.real.token');
      expect(res.status).toBe(401);
    });

    test('returns 401 when user is not found in DB', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // user not found
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    test('returns 401 when user account is inactive', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ ...adminUser, status: 'inactive' }] });
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('parameter validation', () => {
    test('returns 400 for non-integer cycleId', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/abc')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    test('returns 400 for non-integer month query param', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12?month=xyz')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('happy path', () => {
    test('returns 200 with full dashboard payload', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('cycle');
      expect(res.body.data).toHaveProperty('stats');
      expect(res.body.data).toHaveProperty('declarations');
      expect(res.body.data).toHaveProperty('recentLoans');
    });

    test('passes explicit month to model', async () => {
      const token = makeToken();
      await request(app)
        .get('/api/dashboard/cycle/12?month=2')
        .set('Authorization', `Bearer ${token}`);

      expect(mockGetDashboardData).toHaveBeenCalledWith(12, 2);
    });

    test('passes null month when not provided', async () => {
      const token = makeToken();
      await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);

      expect(mockGetDashboardData).toHaveBeenCalledWith(12, null);
    });

    test('unborrowed is 0 when all savings are lent out', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.data.stats.unborrowed).toBe(0);
    });

    test('accepts token in httpOnly cookie', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Cookie', `vb-token=${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('error handling', () => {
    test('returns 404 when cycle not found', async () => {
      const cycleErr = Object.assign(new Error('Cycle not found'), { statusCode: 404 });
      mockGetDashboardData.mockRejectedValueOnce(cycleErr);

      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('propagates unexpected errors to error handler', async () => {
      mockGetDashboardData.mockRejectedValueOnce(new Error('Unexpected DB failure'));

      const token = makeToken();
      const res = await request(app)
        .get('/api/dashboard/cycle/12')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
    });
  });
});
