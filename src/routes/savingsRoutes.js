const express = require('express');
const { body, query } = require('express-validator');
const savingsController = require('../controllers/savingsController');
const { authenticate, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /api/savings:
 *   get:
 *     summary: Get savings for a cycle and month
 *     tags: [Savings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of savings records
 */
router.get(
  '/',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  savingsController.getSavingsByCycle
);

/**
 * @swagger
 * /api/savings/member/{memberId}:
 *   get:
 *     summary: Get member's savings history
 *     tags: [Savings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Member's savings history
 */
router.get(
  '/member/:memberId',
  authenticate,
  [query('cycleId').isInt()],
  validate,
  savingsController.getMemberSavings
);

/**
 * @swagger
 * /api/savings/stats:
 *   get:
 *     summary: Get savings statistics
 *     tags: [Savings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Savings statistics
 */
router.get(
  '/stats',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  savingsController.getSavingsStats
);

/**
 * @swagger
 * /api/savings/deposit:
 *   post:
 *     summary: Record savings deposit (Admin only)
 *     tags: [Savings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - member_id
 *               - cycle_id
 *               - amount
 *               - date
 *             properties:
 *               member_id:
 *                 type: integer
 *               cycle_id:
 *                 type: integer
 *               amount:
 *                 type: number
 *                 format: decimal
 *               date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Savings deposit recorded successfully
 */
router.post(
  '/deposit',
  authenticate,
  isAdmin,
  [
    body('member_id').isInt(),
    body('cycle_id').isInt(),
    body('amount').isFloat({ min: 0.01 }),
    body('date').isDate(),
  ],
  validate,
  savingsController.recordSavingsDeposit
);

module.exports = router;
