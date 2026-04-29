const express = require('express');
const { body, query } = require('express-validator');
const membersController = require('../controllers/membersController');
const { authenticate, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /api/members:
 *   get:
 *     summary: Get all members
 *     tags: [Members]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, exited]
 *     responses:
 *       200:
 *         description: List of members
 */
router.get(
  '/',
  authenticate,
  [query('cycleId').isInt()],
  validate,
  membersController.getAllMembers
);

/**
 * @swagger
 * /api/members/{id}:
 *   get:
 *     summary: Get member by ID
 *     tags: [Members]
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
 *         description: Member details
 */
/**
 * @swagger
 * /api/members/enroll:
 *   post:
 *     summary: Enroll a new member — creates user account + member record atomically (Admin only)
 *     tags: [Members]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, email, cycle_id, joined_date]
 *             properties:
 *               full_name:   { type: string }
 *               email:       { type: string, format: email }
 *               phone:       { type: string }
 *               address:     { type: string }
 *               cycle_id:    { type: integer }
 *               joined_date: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Member enrolled successfully
 *       409:
 *         description: Member already exists in this cycle
 */
router.post(
  '/enroll',
  authenticate,
  isAdmin,
  [
    body('full_name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('cycle_id').isInt(),
    body('joined_date').isDate(),
  ],
  validate,
  membersController.enrollMember
);

// GET /api/members/pending  — must be before /:id to avoid param conflict
router.get('/pending', authenticate, isAdmin, membersController.getPendingMembers);

// POST /api/members/:userId/approve  — approve pending user + enroll into cycle
router.post(
  '/:userId/approve',
  authenticate,
  isAdmin,
  [
    body('cycle_id').isInt(),
    body('joined_date').isDate(),
  ],
  validate,
  membersController.approveMember
);

router.get('/:id', authenticate, membersController.getMemberById);

/**
 * @swagger
 * /api/members/{id}/balance:
 *   get:
 *     summary: Get member balance
 *     tags: [Members]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *         description: Member balance
 */
router.get(
  '/:id/balance',
  authenticate,
  [query('month').isInt()],
  validate,
  membersController.getMemberBalance
);

/**
 * @swagger
 * /api/members/{id}/transactions:
 *   get:
 *     summary: Get member transactions
 *     tags: [Members]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *         schema:
 *           type: integer
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Member transactions
 */
router.get(
  '/:id/transactions',
  authenticate,
  [query('cycleId').isInt()],
  validate,
  membersController.getMemberTransactions
);

/**
 * @swagger
 * /api/members:
 *   post:
 *     summary: Add new member (Admin only)
 *     tags: [Members]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - cycle_id
 *               - joined_date
 *             properties:
 *               user_id:
 *                 type: integer
 *               cycle_id:
 *                 type: integer
 *               joined_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Member added successfully
 */
router.post(
  '/',
  authenticate,
  isAdmin,
  [
    body('user_id').isInt(),
    body('cycle_id').isInt(),
    body('joined_date').isDate(),
  ],
  validate,
  membersController.addMember
);

/**
 * @swagger
 * /api/members/{id}:
 *   put:
 *     summary: Update member (Admin only)
 *     tags: [Members]
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
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, exited]
 *     responses:
 *       200:
 *         description: Member updated successfully
 */
router.put(
  '/:id',
  authenticate,
  isAdmin,
  [body('status').optional().isIn(['active', 'inactive', 'exited'])],
  validate,
  membersController.updateMember
);

/**
 * @swagger
 * /api/members/{id}/fees:
 *   patch:
 *     summary: Record a social fund or membership fee payment (Admin only, month 1 only)
 *     tags: [Members]
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
 *             required: [cycleId, feeType, paymentDate]
 *             properties:
 *               cycleId:     { type: integer }
 *               feeType:     { type: string, enum: [social_fund, membership_fee] }
 *               paymentDate: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Fee payment recorded
 *       400:
 *         description: Not month 1, or fee already paid
 *       404:
 *         description: Member or cycle not found
 */
router.patch(
  '/:id/fees',
  authenticate,
  isAdmin,
  [
    body('cycleId').isInt(),
    body('feeType').isIn(['social_fund', 'membership_fee']),
    body('paymentDate').isDate(),
  ],
  validate,
  membersController.recordFeePayment
);

module.exports = router;
