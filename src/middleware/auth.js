const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { ROLES } = require('../config/constants');

/*** we verify the JWT token and attach user to request */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header or httpOnly cookie
    const authHeader = req.headers.authorization;
    let token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies['vb-token']) {
      token = req.cookies['vb-token'];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const result = await db.query(
      'SELECT id, email, full_name, phone, role, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive',
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
    });
  }
};

/**
 * Check if user has required role
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this resource',
      });
    }

    next();
  };
};

/**
 * Check if user is Super Admin
 */
const isSuperAdmin = authorize(ROLES.SUPER_ADMIN);

/**
 * Check if user is Admin or Super Admin
 */
const isAdmin = authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN);

/**
 * Check if user is accessing their own resource
 */
const isOwnerOrAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated',
    });
  }

  const resourceUserId = req.params.userId || req.params.id;

  // Allow if user is admin or accessing their own resource
  if (
    req.user.role === ROLES.SUPER_ADMIN ||
    req.user.role === ROLES.ADMIN ||
    req.user.id === parseInt(resourceUserId, 10)
  ) {
    return next();
  }

  res.status(403).json({
    success: false,
    message: 'Not authorized to access this resource',
  });
};

module.exports = {
  authenticate,
  authorize,
  isSuperAdmin,
  isAdmin,
  isOwnerOrAdmin,
};
