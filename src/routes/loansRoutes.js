const express = require('express');
const { body, query } = require('express-validator');
const loansController = require('../controllers/loansController');
const loanRepaymentsController = require('../controllers/loanRepaymentsController');
const { authenticate, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /api/loans:
 *   get:
 *     summary: Get loans for a cycle
 *     tags: [Loans]
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
 *           enum: [pending, approved, disbursed, repaid, defaulted]
 *       - in: query
 *         name: member_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of loans
 */
router.get(
  '/',
  authenticate,
  [query('cycleId').isInt()],
  validate,
  loansController.getLoansByCycle
);

/**
 * @swagger
 * /api/loans/{id}:
 *   get:
 *     summary: Get loan by ID
 *     tags: [Loans]
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
 *         description: Loan details
 */
/**
 * @swagger
 * /api/loans/stats:
 *   get:
 *     summary: Get loans statistics
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Loans statistics
 */
router.get(
  '/stats',
  authenticate,
  [query('cycleId').isInt()],
  validate,
  loansController.getLoansStats
);

/**
 * @swagger
 * /api/loans/{id}:
 *   get:
 *     summary: Get loan by ID
 *     tags: [Loans]
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
 *         description: Loan details
 */
router.get('/:id', authenticate, loansController.getLoanById);

/**
 * @swagger
 * /api/loans/disburse:
 *   post:
 *     summary: Disburse loan (Admin only)
 *     tags: [Loans]
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
 *               - loan_type
 *               - amount
 *               - disbursed_date
 *             properties:
 *               member_id:
 *                 type: integer
 *               cycle_id:
 *                 type: integer
 *               loan_type:
 *                 type: string
 *                 enum: [original, top_up, emergency]
 *               amount:
 *                 type: number
 *                 format: decimal
 *               disbursed_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Loan disbursed successfully
 */
router.post(
  '/disburse',
  authenticate,
  isAdmin,
  [
    body('member_id').isInt(),
    body('cycle_id').isInt(),
    body('loan_type').isIn(['original', 'top_up', 'emergency']),
    body('amount').isFloat({ min: 0.01 }),
    body('disbursed_date').isDate(),
  ],
  validate,
  loansController.disburseLoan
);

/**
 * @swagger
 * /api/loans/{loanId}/repayments:
 *   post:
 *     summary: Submit loan repayment for approval
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
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
 *               - amount
 *               - paymentMethod
 *               - paymentProofId
 *             properties:
 *               amount:
 *                 type: number
 *                 format: decimal
 *               paymentMethod:
 *                 type: string
 *                 enum: [mobile_money, cash, bank_transfer]
 *               paymentProofId:
 *                 type: integer
 *               referenceNumber:
 *                 type: string
 *     responses:
 *       201:
 *         description: Repayment submitted for approval
 */
router.post(
  '/:loanId/repayments',
  authenticate,
  [
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').isIn(['mobile_money', 'cash', 'bank_transfer']),
    body('paymentProofId').isInt(),
  ],
  validate,
  loanRepaymentsController.createRepayment
);

/**
 * @swagger
 * /api/loans/{loanId}/repayments:
 *   get:
 *     summary: Get repayments for a loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of repayments
 */
router.get('/:loanId/repayments', authenticate, loanRepaymentsController.getRepaymentsByLoan);

/**
 * POST /api/loans/:id/repayment
 * Record a direct principal + interest repayment (Admin only)
 */
router.post(
  '/:id/repayment',
  authenticate,
  isAdmin,
  [
    body('principal_amount').isFloat({ min: 0.01 }),
    body('date').isDate(),
  ],
  validate,
  loansController.recordLoanRepayment
);

module.exports = router;