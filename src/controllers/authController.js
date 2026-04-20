const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const db = require('../config/database');
const { logAudit } = require('../utils/audit.util');
const { ROLES } = require('../config/constants');

const ACTIVE_STATUS = 'active';
const PRIVILEGED_SIGNUP_ROLES = new Set([ROLES.ADMIN]);
const MANAGEABLE_ROLES = new Set([ROLES.MEMBER, ROLES.ADMIN, ROLES.SUPER_ADMIN]);

const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });

const isProduction = process.env.NODE_ENV === 'production';

const setTokenCookie = (res, token) => {
  res.cookie('vb-token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const toUserPayload = (user) => ({
  id: user.id,
  // memberNo: user.member_no,
  email: user.email,
  full_name: user.full_name,
  // nationalId: user.national_id,
  phone: user.phone,
  role: user.role,
  status: user.status,
  createdAt: user.created_at,
});

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const insertUser = async ({ email, password, full_name, phone, role }) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password || !full_name) {
    const error = new Error('email, password, and full_name are required');
    error.statusCode = 400;
    throw error;
  }

  if (password.length < 8) {
    const error = new Error('Password must be at least 8 characters long');
    error.statusCode = 400;
    throw error;
  }

  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existingUser.rows.length > 0) {
    const error = new Error('User with this email already exists');
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.query(
    `INSERT INTO users (email, password_hash, full_name, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, full_name, phone, role, status, created_at`,
    [normalizedEmail, passwordHash, full_name.trim(), phone?.trim() || null, role]
  );

  return result.rows[0];
};

const getUserById = async (userId) => {
  const result = await db.query(
    'SELECT id, email, full_name, phone, role, status, created_at FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0] || null;
};

const getSuperAdminCount = async () => {
  const result = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', [ROLES.SUPER_ADMIN]);
  return result.rows[0]?.count || 0;
};

const register = (req, res, next) => {
  passport.authenticate('local-signup', { session: false }, async (err, user, info) => {
    if (err) {
      console.error('Register error:', err);
      return res.status(500).json({ success: false, message: 'Error registering user' });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: info?.message || 'Registration failed',
      });
    }

    const token = generateToken(user.id, user.role);
    setTokenCookie(res, token);

    await logAudit(db.pool, null, 'USER_REGISTERED', 'users', user.id, null, user, req.ip, req.headers['user-agent']);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: toUserPayload(user),
        token,
      },
    });
  })(req, res, next);
};

const login = (req, res, next) => {
  passport.authenticate('local-login', { session: false }, async (err, user, info) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).json({ success: false, message: 'Error logging in' });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: info?.message || 'Invalid email or password',
      });
    }

    const token = generateToken(user.id, user.role);
    setTokenCookie(res, token);

    await logAudit(db.pool, user.id, 'USER_LOGIN', 'users', user.id, null, null, req.ip, req.headers['user-agent']);

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: toUserPayload(user),
        token,
      },
    });
  })(req, res, next);
};

const refreshToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    const newToken = generateToken(decoded.userId, decoded.role);

    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { token: newToken },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }
};

const createAdminUser = async (req, res) => {
  try {
    const { full_name, email, phone, password, role = ROLES.ADMIN } = req.body;

    if (!PRIVILEGED_SIGNUP_ROLES.has(role)) {
      return res.status(400).json({
        success: false,
        message: 'Privileged user creation only supports the admin role',
      });
    }

    const user = await insertUser({ full_name, email, phone, password, role });

    await logAudit(
      db.pool,
      req.user.id,
      'ADMIN_USER_CREATED',
      'users',
      user.id,
      null,
      { email: user.email, role: user.role },
      req.ip,
      req.headers['user-agent']
    );

    return res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        user: toUserPayload(user),
      },
    });
  } catch (error) {
    console.error('Create admin user error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error creating admin user',
    });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const { role } = req.body;

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid userId is required',
      });
    }

    if (!MANAGEABLE_ROLES.has(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role supplied',
      });
    }

    if (req.user.id === userId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role',
      });
    }

    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (existingUser.role === role) {
      return res.json({
        success: true,
        message: 'User role unchanged',
        data: {
          user: toUserPayload(existingUser),
        },
      });
    }

    if (existingUser.role === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
      const superAdminCount = await getSuperAdminCount();
      if (superAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last super admin',
        });
      }
    }

    const result = await db.query(
      `UPDATE users
       SET role = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, email, full_name, phone, role, status, created_at`,
      [role, userId]
    );

    const updatedUser = result.rows[0];

    await logAudit(
      db.pool,
      req.user.id,
      'USER_ROLE_UPDATED',
      'users',
      updatedUser.id,
      { role: existingUser.role },
      { role: updatedUser.role },
      req.ip,
      req.headers['user-agent']
    );

    return res.json({
      success: true,
      message: 'User role updated successfully',
      data: {
        user: toUserPayload(updatedUser),
      },
    });
  } catch (error) {
    console.error('Update user role error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating user role',
    });
  }
};

const listUsers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, full_name, phone, role, status, created_at
       FROM users
       ORDER BY
         CASE role
           WHEN $1 THEN 0
           WHEN $2 THEN 1
           ELSE 2
         END,
         created_at DESC`,
      [ROLES.SUPER_ADMIN, ROLES.ADMIN]
    );

    return res.json({
      success: true,
      data: {
        users: result.rows.map(toUserPayload),
      },
    });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving users',
    });
  }
};

const logout = async (req, res) => {
  try {
    if (req.user?.id) {
      await logAudit(
        db.pool,
        req.user.id,
        'USER_LOGOUT',
        'users',
        req.user.id,
        null,
        null,
        req.ip,
        req.headers['user-agent']
      );
    }

    res.clearCookie('vb-token');
    return res.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error logging out',
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      newPasswordHash,
      userId,
    ]);

    await logAudit(db.pool, userId, 'PASSWORD_CHANGED', 'users', userId, null, null, req.ip, req.headers['user-agent']);

    return res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error changing password',
    });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const result = await db.query(
      'SELECT id, email, full_name, phone, role, status, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      data: toUserPayload(result.rows[0]),
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting user information',
    });
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  createAdminUser,
  updateUserRole,
  listUsers,
  logout,
  changePassword,
  getCurrentUser,
};
