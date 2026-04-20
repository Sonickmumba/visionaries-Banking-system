const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

// ─── Mocks (must be set up before requiring app modules) ─────────────────────

const mockDbQuery = jest.fn();
const mockDbPool = { query: jest.fn() };

jest.mock('../../src/config/database', () => ({
  query: mockDbQuery,
  pool: mockDbPool,
}));

jest.mock('../../src/utils/audit.util', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

// Mock connect-pg-simple to avoid real PG session store
jest.mock('connect-pg-simple', () => {
  return () =>
    class MockPgSession {
      constructor() {}
    };
});

// Mock cloudinary
jest.mock('cloudinary', () => ({
  v2: { config: jest.fn() },
}));

// Mock passport strategies configuration
jest.mock('../../src/config/passport', () => jest.fn());

// ─── Build a lightweight test app that mirrors real route wiring ─────────────

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

// Configure test passport strategies
passport.use(
  'local-signup',
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password', passReqToCallback: true, session: false },
    async (req, email, password, done) => {
      try {
        const existing = await mockDbQuery('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
          return done(null, false, { message: 'User with this email already exists' });
        }
        const hash = await bcrypt.hash(password, 10);
        const result = await mockDbQuery(
          'INSERT INTO users',
          [email, hash, req.body.name, req.body.nationalId, req.body.phone || null, 'member']
        );
        return done(null, result.rows[0]);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.use(
  'local-login',
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password', session: false },
    async (email, password, done) => {
      try {
        const result = await mockDbQuery('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, { id }));

// Now build the test Express app
const session = require('express-session');
const authRoutes = require('../../src/routes/authRoutes');

const app = express();
app.use(express.json());
app.use(cookieParser('test-cookie-secret'));
app.use(
  session({
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use('/api/auth', authRoutes);

// ─── Supertest ───────────────────────────────────────────────────────────────

const request = require('supertest');

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
};

let hashedPassword;

beforeAll(async () => {
  hashedPassword = await bcrypt.hash('ValidPass123', 10);
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /api/auth/signup ───────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  test('201 - registers a new user', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT check — no existing user
      .mockResolvedValueOnce({ rows: [fakeUser] }); // INSERT

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@example.com', password: 'ValidPass123', name: 'Test User', nationalId: '123456' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.token).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('400 - rejects duplicate email', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // SELECT — user exists

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'test@example.com', password: 'ValidPass123', name: 'Test', nationalId: '123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already exists/i);
  });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('200 - logs in with valid credentials', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ ...fakeUser, password_hash: hashedPassword }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'ValidPass123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  test('401 - rejects wrong password', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ ...fakeUser, password_hash: hashedPassword }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('401 - rejects non-existent email', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/auth/refresh-token ────────────────────────────────────────────

describe('POST /api/auth/refresh-token', () => {
  test('200 - refreshes a valid token', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '7d' });

    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });

  test('400 - requires token in body', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Token is required');
  });

  test('401 - rejects garbage token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ token: 'not.a.real.token' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  test('200 - returns current user when authenticated', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    // authenticate middleware does a SELECT
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 1, email: 'test@example.com', name: 'Test User', phone: '0999', role: 'member', is_active: true }],
    });
    // getCurrentUser does another SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [fakeUser] });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('test@example.com');
  });

  test('401 - rejects request without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('No token provided');
  });

  test('401 - rejects expired token', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '0s' });

    // Small delay so it actually expires
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Token expired');
  });
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('200 - logs out authenticated user', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 1, email: 'test@example.com', name: 'Test', phone: '0999', role: 'member', is_active: true }],
    });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Logout successful');
  });

  test('401 - rejects unauthenticated logout', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(401);
  });
});
