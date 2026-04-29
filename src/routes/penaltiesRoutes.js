const express = require('express');
const router = express.Router();
const penaltiesController = require('../controllers/penaltiesController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Penalties
 *   description: Penalty assessment and management
 */

/**
 * @swagger
 * /api/penalties/cycle/{cycleId}:
 *   get:
 *     summary: Get penalties by cycle
 *     tags: [Penalties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [assessed, paid, waived, converted_to_loan]
 *       - in: query
 *         name: memberId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of penalties
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/cycle/:cycleId',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').optional().isInt().withMessage('Month must be an integer'),
    query('status').optional().isIn(['assessed', 'paid', 'waived', 'converted_to_loan']),
    query('memberId').optional().isInt().withMessage('Member ID must be an integer')
  ]),
  penaltiesController.getPenaltiesByCycle
);

/**
 * @swagger
 * /api/penalties/{id}:
 *   get:
 *     summary: Get penalty by ID
 *     tags: [Penalties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Penalty details
 *       404:
 *         description: Penalty not found
 */
router.get(
  '/:id',
  authenticate,
  validate([
    param('id').isInt().withMessage('Valid penalty ID is required')
  ]),
  penaltiesController.getPenaltyById
);

/**
 * @swagger
 * /api/penalties:
 *   post:
 *     summary: Assess a penalty
 *     tags: [Penalties]
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
 *               - month
 *               - penalty_type
 *               - amount
 *             properties:
 *               member_id:
 *                 type: integer
 *               cycle_id:
 *                 type: integer
 *               month:
 *                 type: integer
 *               penalty_type:
 *                 type: string
 *               amount:
 *                 type: number
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Penalty assessed successfully
 *       400:
 *         description: Invalid input
 */
router.post(
  '/',
  authenticate,
  isAdmin,
  validate([
    body('member_id').isInt().withMessage('Valid member ID is required'),
    body('cycle_id').isInt().withMessage('Valid cycle ID is required'),
    body('month').isInt().withMessage('Month is required'),
    body('penalty_type').notEmpty().withMessage('Penalty type is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('reason').optional().isString()
  ]),
  penaltiesController.assessPenalty
);

/**
 * @swagger
 * /api/penalties/{id}/status:
 *   put:
 *     summary: Update penalty status
 *     tags: [Penalties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [assessed, paid, waived, converted_to_loan]
 *     responses:
 *       200:
 *         description: Penalty status updated
 *       404:
 *         description: Penalty not found
 */
router.put(
  '/:id/status',
  authenticate,
  isAdmin,
  validate([
    param('id').isInt().withMessage('Valid penalty ID is required'),
    body('status').isIn(['assessed', 'paid', 'waived', 'converted_to_loan']).withMessage('Valid status is required')
  ]),
  penaltiesController.updatePenaltyStatus
);

/**
 * @swagger
 * /api/penalties/cycle/{cycleId}/stats:
 *   get:
 *     summary: Get penalties statistics
 *     tags: [Penalties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Penalties statistics
 */
router.get(
  '/cycle/:cycleId/stats',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').optional().isInt().withMessage('Month must be an integer')
  ]),
  penaltiesController.getPenaltiesStats
);

/**
 * @swagger
 * /api/penalties/cycle/{cycleId}/auto-assess:
 *   post:
 *     summary: Auto-assess failure to declare penalties
 *     tags: [Penalties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - month
 *             properties:
 *               month:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Penalties auto-assessed
 *       400:
 *         description: Invalid input
 */
router.post(
  '/cycle/:cycleId/auto-assess',
  authenticate,
  isAdmin,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    body('month').isInt().withMessage('Month is required')
  ]),
  penaltiesController.assessFailureToDeclarePenalties
);

module.exports = router;
