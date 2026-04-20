const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Mock dependencies before requiring the controller
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('../../src/utils/audit.util', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('passport', () => {
  const authenticateMock = jest.fn();
  return {
    authenticate: authenticateMock,
  };
});

const db = require('../../src/config/database');
const { logAudit } = require('../../src/utils/audit.util');
const passport = require('passport');
const authController = require('../../src/controllers/authController');

// Helper: create mock req/res/next
const mockReq = (overrides = {}) => ({
  body: {},
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

const fakeUser = {
  id: 1,
  member_no: 'MEM001',
  email: 'test@example.com',
  name: 'Test User',
  national_id: '123456',
  phone: '0999111222',
  role: 'member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  password_hash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── register ────────────────────────────────────────────────────────────────

describe('authController.register', () => {
  const setupPassportMock = (err, user, info) => {
    passport.authenticate.mockImplementation((strategy, opts, callback) => {
      return (req, res, next) => callback(err, user, info);
    });
  };

  test('returns 201 with user and token on successful registration', async () => {
    setupPassportMock(null, fakeUser, null);
    const req = mockReq({ body: { email: 'test@example.com', password: 'pass', name: 'Test', nationalId: '123' } });
    const res = mockRes();

    await authController.register(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'User registered successfully',
        data: expect.objectContaining({
          user: expect.objectContaining({ email: 'test@example.com' }),
          token: expect.any(String),
        }),
      })
    );
    expect(res.cookie).toHaveBeenCalledWith('vb-token', expect.any(String), expect.any(Object));
    expect(logAudit).toHaveBeenCalledWith(
      db.pool, null, 'USER_REGISTERED', 'users', fakeUser.id,
      null, fakeUser, '127.0.0.1', 'test-agent'
    );
  });

  test('returns 400 when passport returns no user', async () => {
    setupPassportMock(null, false, { message: 'Email already exists' });
    const req = mockReq();
    const res = mockRes();

    await authController.register(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Email already exists' })
    );
  });

  test('returns 500 on passport error', async () => {
    setupPassportMock(new Error('DB down'), null, null);
    const req = mockReq();
    const res = mockRes();

    await authController.register(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Error registering user' })
    );
  });
});

// ─── login ────────────────────────────────────────────────────────────────────

describe('authController.login', () => {
  const setupPassportMock = (err, user, info) => {
    passport.authenticate.mockImplementation((strategy, opts, callback) => {
      return (req, res, next) => callback(err, user, info);
    });
  };

  test('returns 200 with user and token on successful login', async () => {
    setupPassportMock(null, fakeUser, null);
    const req = mockReq({ body: { email: 'test@example.com', password: 'password' } });
    const res = mockRes();

    await authController.login(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Login successful',
        data: expect.objectContaining({
          user: expect.objectContaining({ email: 'test@example.com' }),
          token: expect.any(String),
        }),
      })
    );
    expect(res.cookie).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalled();
  });

  test('returns 401 when credentials are invalid', async () => {
    setupPassportMock(null, false, { message: 'Invalid email or password' });
    const req = mockReq();
    const res = mockRes();

    await authController.login(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid email or password' })
    );
  });

  test('returns 500 on passport error', async () => {
    setupPassportMock(new Error('DB down'), null, null);
    const req = mockReq();
    const res = mockRes();

    await authController.login(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── refreshToken ─────────────────────────────────────────────────────────────

describe('authController.refreshToken', () => {
  test('returns new token when given a valid token', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '7d' });
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

  test('returns 400 when no token provided', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    await authController.refreshToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Token is required' })
    );
  });

  test('returns 401 for an invalid token', async () => {
    const req = mockReq({ body: { token: 'garbage.token.value' } });
    const res = mockRes();

    await authController.refreshToken(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid token' })
    );
  });
});

// ─── logout ──────────────────────────────────────────────────────────────────

describe('authController.logout', () => {
  test('clears cookie and returns success', async () => {
    const req = mockReq({ user: { id: 1 } });
    const res = mockRes();

    await authController.logout(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith('vb-token');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'Logout successful' })
    );
    expect(logAudit).toHaveBeenCalled();
  });

  test('works even without req.user', async () => {
    const req = mockReq({ user: null });
    const res = mockRes();

    await authController.logout(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith('vb-token');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    expect(logAudit).not.toHaveBeenCalled();
  });
});

// ─── changePassword ──────────────────────────────────────────────────────────

describe('authController.changePassword', () => {
  test('returns 401 if no user on request', async () => {
    const req = mockReq({ body: { currentPassword: 'old', newPassword: 'new' } });
    const res = mockRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 if user not found in DB', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = mockReq({ user: { id: 99 }, body: { currentPassword: 'old', newPassword: 'new' } });
    const res = mockRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 400 if current password is wrong', async () => {
    const hash = await bcrypt.hash('correctpass', 10);
    db.query.mockResolvedValueOnce({ rows: [{ password_hash: hash }] });
    const req = mockReq({ user: { id: 1 }, body: { currentPassword: 'wrongpass', newPassword: 'new' } });
    const res = mockRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Current password is incorrect' })
    );
  });

  test('changes password successfully', async () => {
    const hash = await bcrypt.hash('oldpass', 10);
    db.query
      .mockResolvedValueOnce({ rows: [{ password_hash: hash }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const req = mockReq({ user: { id: 1 }, body: { currentPassword: 'oldpass', newPassword: 'newpass' } });
    const res = mockRes();

    await authController.changePassword(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'Password changed successfully' })
    );
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalled();
  });
});

// ─── getCurrentUser ──────────────────────────────────────────────────────────

describe('authController.getCurrentUser', () => {
  test('returns 401 if no user on request', async () => {
    const req = mockReq();
    const res = mockRes();

    await authController.getCurrentUser(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 if user not in DB', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = mockReq({ user: { id: 99 } });
    const res = mockRes();

    await authController.getCurrentUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns user payload on success', async () => {
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
          name: 'Test User',
          role: 'member',
        }),
      })
    );
  });
});
