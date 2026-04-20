const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const db = require('../config/database');
const { logAudit } = require('../utils/audit.util');

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
  memberNo: user.member_no,
  email: user.email,
  full_name: user.full_name,
  nationalId: user.national_id,
  phone: user.phone,
  role: user.role,
  isActive: user.is_active,
  createdAt: user.created_at,
});

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
      'SELECT id, member_no, email, name, national_id, phone, role, is_active, created_at FROM users WHERE id = $1',
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
  logout,
  changePassword,
  getCurrentUser,
};
