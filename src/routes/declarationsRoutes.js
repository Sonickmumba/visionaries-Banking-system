const express = require('express');
const { body, query } = require('express-validator');
const declarationsController = require('../controllers/declarationsController');
const { authenticate, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /api/declarations:
 *   get:
 *     summary: Get declarations for a cycle and month
 *     tags: [Declarations]
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
 *         description: List of declarations
 */
router.get(
  '/',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  declarationsController.getDeclarationsByCycle
);

/**
 * @swagger
 * /api/declarations/{id}:
 *   get:
 *     summary: Get declaration by ID
 *     tags: [Declarations]
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
 *         description: Declaration details
 */
/**
 * @swagger
 * /api/declarations/member/{memberId}:
 *   get:
 *     summary: Get member's declaration for a month
 *     tags: [Declarations]
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
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Member's declaration
 */
router.get(
  '/member/:memberId',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  declarationsController.getMemberDeclaration
);

/**
 * @swagger
 * /api/declarations/stats:
 *   get:
 *     summary: Get declaration statistics
 *     tags: [Declarations]
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
 *         description: Declaration statistics
 */
router.get(
  '/stats',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  declarationsController.getDeclarationStats
);

/**
 * @swagger
 * /api/declarations/missing:
 *   get:
 *     summary: Get members without declaration
 *     tags: [Declarations]
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
 *         description: List of members who haven't declared
 */
router.get(
  '/missing',
  authenticate,
  [
    query('cycleId').isInt(),
    query('month').isInt(),
  ],
  validate,
  declarationsController.getMembersWithoutDeclaration
);

/**
 * @swagger
 * /api/declarations:
 *   post:
 *     summary: Submit declaration
 *     tags: [Declarations]
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
 *             properties:
 *               member_id:
 *                 type: integer
 *               cycle_id:
 *                 type: integer
 *               savings_amount:
 *                 type: number
 *                 format: decimal
 *               loan_request:
 *                 type: number
 *                 format: decimal
 *               principal_repayment:
 *                 type: number
 *                 format: decimal
 *               interest_repayment:
 *                 type: number
 *                 format: decimal
 *     responses:
 *       201:
 *         description: Declaration submitted successfully
 */
router.post(
  '/',
  authenticate,
  [
    body('member_id').isInt(),
    body('cycle_id').isInt(),
    body('savings_amount').optional().isFloat({ min: 0 }),
    body('loan_request').optional().isFloat({ min: 0 }),
    body('principal_repayment').optional().isFloat({ min: 0 }),
    body('interest_repayment').optional().isFloat({ min: 0 }),
  ],
  validate,
  declarationsController.submitDeclaration
);

/**
 * @swagger
 * /api/declarations/{id}/status:
 *   put:
 *     summary: Update declaration status (Admin only)
 *     tags: [Declarations]
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
 *                 enum: [submitted, processed, rejected]
 *     responses:
 *       200:
 *         description: Status updated successfully
 */
router.put(
  '/:id/status',
  authenticate,
  isAdmin,
  [body('status').isIn(['submitted', 'processed', 'rejected'])],
  validate,
  declarationsController.updateDeclarationStatus
);

/**
 * @swagger
 * /api/declarations/{id}:
 *   get:
 *     summary: Get declaration by ID
 *     tags: [Declarations]
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
 *         description: Declaration details
 */
router.get('/:id', authenticate, declarationsController.getDeclarationById);

module.exports = router;
