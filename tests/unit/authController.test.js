const jwt = require('jsonwebtoken');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('../../src/utils/audit.util', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('passport', () => ({
  authenticate: jest.fn(),
}));

const db = require('../../src/config/database');
const { logAudit } = require('../../src/utils/audit.util');
const passport = require('passport');
const authController = require('../../src/controllers/authController');

const fakeUser = {
  id: 1,
  email: 'test@example.com',
  full_name: 'Test User',
  phone: '0999111222',
  role: 'member',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  password_hash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  cookies: {},
  user: null,
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

const setupPassportMock = (err, user, info) => {
  passport.authenticate.mockImplementation((strategy, options, callback) => {
    return (req, res, next) => callback(err, user, info);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authController.register', () => {
  test('returns 201 with user and token on successful registration', async () => {
    setupPassportMock(null, fakeUser, null);
    const req = mockReq({ body: { email: 'test@example.com', password: 'ValidPass123', full_name: 'Test User' } });
    const res = mockRes();

    await authController.register(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.cookie).toHaveBeenCalledWith('vb-token', expect.any(String), expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user: expect.objectContaining({
            email: 'test@example.com',
            full_name: 'Test User',
            role: 'member',
          }),
          token: expect.any(String),
        }),
      })
    );
  });
});

describe('authController.login', () => {
  test('returns 200 with user and token on successful login', async () => {
    setupPassportMock(null, fakeUser, null);
    const req = mockReq({ body: { email: 'test@example.com', password: 'ValidPass123' } });
    const res = mockRes();

    await authController.login(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user: expect.objectContaining({ email: 'test@example.com' }),
          token: expect.any(String),
        }),
      })
    );
  });
});

describe('authController.refreshToken', () => {
  test('returns a refreshed token', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    const req = mockReq({ body: { token } });
    const res = mockRes();

    await authController.refreshToken(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ token: expect.any(String) }),
      })
    );
  });
});

describe('authController.createAdminUser', () => {
  test('creates an admin user for a super admin request', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            email: 'admin@example.com',
            full_name: 'Admin User',
            phone: '0999',
            role: 'admin',
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

    const req = mockReq({
      user: { id: 10, role: 'super_admin' },
      body: {
        email: 'admin@example.com',
        full_name: 'Admin User',
        phone: '0999',
        password: 'ValidPass123',
      },
    });
    const res = mockRes();

    await authController.createAdminUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user: expect.objectContaining({ role: 'admin', email: 'admin@example.com' }),
        }),
      })
    );
    expect(logAudit).toHaveBeenCalledWith(
      db.pool,
      10,
      'ADMIN_USER_CREATED',
      'users',
      2,
      null,
      { email: 'admin@example.com', role: 'admin' },
      '127.0.0.1',
      'test-agent'
    );
  });

  test('rejects unsupported privileged roles', async () => {
    const req = mockReq({
      user: { id: 10, role: 'super_admin' },
      body: {
        email: 'super@example.com',
        full_name: 'Super User',
        password: 'ValidPass123',
        role: 'super_admin',
      },
    });
    const res = mockRes();

    await authController.createAdminUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/admin role/i) })
    );
  });
});

describe('authController.updateUserRole', () => {
  test('rejects self role changes', async () => {
    const req = mockReq({ user: { id: 7, role: 'super_admin' }, params: { userId: '7' }, body: { role: 'admin' } });
    const res = mockRes();

    await authController.updateUserRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'You cannot change your own role' })
    );
  });

  test('blocks demotion of the last super admin', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 4, email: 'boss@example.com', full_name: 'Boss', phone: null, role: 'super_admin', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const req = mockReq({ user: { id: 1, role: 'super_admin' }, params: { userId: '4' }, body: { role: 'admin' } });
    const res = mockRes();

    await authController.updateUserRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Cannot demote the last super admin' })
    );
  });

  test('updates another user role successfully', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, email: 'admin@example.com', full_name: 'Admin', phone: null, role: 'admin', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 9, email: 'admin@example.com', full_name: 'Admin', phone: null, role: 'super_admin', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
      });

    const req = mockReq({ user: { id: 1, role: 'super_admin' }, params: { userId: '9' }, body: { role: 'super_admin' } });
    const res = mockRes();

    await authController.updateUserRole(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user: expect.objectContaining({ role: 'super_admin' }),
        }),
      })
    );
  });
});

describe('authController.changePassword', () => {
  test('returns 401 if request is unauthenticated', async () => {
    const req = mockReq({ body: { currentPassword: 'old', newPassword: 'new' } });
    const res = mockRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('authController.getCurrentUser', () => {
  test('returns the normalized user payload', async () => {
    db.query.mockResolvedValueOnce({ rows: [fakeUser] });
    const req = mockReq({ user: { id: 1 } });
    const res = mockRes();

    await authController.getCurrentUser(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 1,
          email: 'test@example.com',
          full_name: 'Test User',
          role: 'member',
          status: 'active',
        }),
      })
    );
  });
});