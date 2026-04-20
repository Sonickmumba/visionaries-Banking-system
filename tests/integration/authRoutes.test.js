const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const request = require('supertest');

const mockDbQuery = jest.fn();
const mockDbPool = { query: jest.fn() };

jest.mock('../../src/config/database', () => ({
  query: mockDbQuery,
  pool: mockDbPool,
}));

jest.mock('../../src/utils/audit.util', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('connect-pg-simple', () => {
  return () =>
    class MockPgSession {
      constructor() {}
    };
});

jest.mock('cloudinary', () => ({
  v2: { config: jest.fn() },
}));

jest.mock('../../src/config/passport', () => jest.fn());

const authRoutes = require('../../src/routes/authRoutes');

passport.use(
  'local-signup',
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password', passReqToCallback: true, session: false },
    async (req, email, password, done) => {
      try {
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await mockDbQuery('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (existing.rows.length > 0) {
          return done(null, false, { message: 'User with this email already exists' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await mockDbQuery(
          'INSERT INTO users',
          [normalizedEmail, hash, req.body.full_name, req.body.phone || null, 'member']
        );
        return done(null, result.rows[0]);
      } catch (error) {
        return done(error);
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
        const normalizedEmail = email.trim().toLowerCase();
        const result = await mockDbQuery('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        if (result.rows.length === 0) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, { id }));

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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/signup', () => {
  test('registers a member account', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            email: 'member@example.com',
            full_name: 'Member User',
            phone: '0999',
            role: 'member',
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'member@example.com', password: 'ValidPass123', full_name: 'Member User', phone: '0999' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('member');
  });
});

describe('POST /api/auth/admin-users', () => {
  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/admin-users')
      .send({ email: 'admin@example.com', password: 'ValidPass123', full_name: 'Admin User' });

    expect(res.status).toBe(401);
  });

  test('forbids non-super-admin users', async () => {
    const token = jwt.sign({ userId: 2, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 2, email: 'admin@example.com', full_name: 'Admin', phone: null, role: 'admin', status: 'active' }],
    });

    const res = await request(app)
      .post('/api/auth/admin-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'newadmin@example.com', password: 'ValidPass123', full_name: 'New Admin' });

    expect(res.status).toBe(403);
  });

  test('allows super admins to create admin users', async () => {
    const token = jwt.sign({ userId: 1, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'root@example.com', full_name: 'Root', phone: null, role: 'super_admin', status: 'active' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 3, email: 'newadmin@example.com', full_name: 'New Admin', phone: null, role: 'admin', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
      });

    const res = await request(app)
      .post('/api/auth/admin-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'newadmin@example.com', password: 'ValidPass123', full_name: 'New Admin' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('admin');
  });
});

describe('PATCH /api/auth/users/:userId/role', () => {
  test('prevents super admins from changing their own role', async () => {
    const token = jwt.sign({ userId: 1, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 1, email: 'root@example.com', full_name: 'Root', phone: null, role: 'super_admin', status: 'active' }],
    });

    const res = await request(app)
      .patch('/api/auth/users/1/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('You cannot change your own role');
  });
});

describe('GET /api/auth/users', () => {
  test('allows super admins to list users', async () => {
    const token = jwt.sign({ userId: 1, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'root@example.com', full_name: 'Root', phone: null, role: 'super_admin', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, email: 'root@example.com', full_name: 'Root', phone: null, role: 'super_admin', status: 'active', created_at: '2026-01-01T00:00:00Z' },
          { id: 2, email: 'admin@example.com', full_name: 'Admin', phone: '0999', role: 'admin', status: 'active', created_at: '2026-01-02T00:00:00Z' },
        ],
      });

    const res = await request(app)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toHaveLength(2);
  });
});

describe('GET /api/auth/me', () => {
  test('returns the current authenticated user', async () => {
    const token = jwt.sign({ userId: 1, role: 'member' }, process.env.JWT_SECRET, { expiresIn: '1d' });

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'member@example.com', full_name: 'Member User', phone: '0999', role: 'member', status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, email: 'member@example.com', full_name: 'Member User', phone: '0999', role: 'member', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
      });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.full_name).toBe('Member User');
  });
});