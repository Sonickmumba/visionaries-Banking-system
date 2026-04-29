const express = require('express');
const authController = require('../controllers/authController');
const { authenticate, isSuperAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', authController.register);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.get('/users', authenticate, isSuperAdmin, authController.listUsers);
router.post('/admin-users', authenticate, isSuperAdmin, authController.createAdminUser);
router.patch('/users/:userId/role', authenticate, isSuperAdmin, authController.updateUserRole);
router.get('/me', authenticate, authController.getCurrentUser);
router.post('/logout', authenticate, authController.logout);

module.exports = router;
