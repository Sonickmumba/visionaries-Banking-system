const express = require('express');
const router = express.Router();
const loanRepaymentsController = require('../controllers/loanRepaymentsController');
const { authenticate } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Loan Repayments
 *   description: Loan repayment management endpoints
 */

/**
 * @swagger
 * /api/repayments/generate-reference:
 *   get:
 *     summary: Generate a unique reference number
 *     tags: [Loan Repayments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reference number generated
 *       401:
 *         description: Unauthorized
 */
router.get('/generate-reference', authenticate, loanRepaymentsController.generateReference);

/**
 * @swagger
 * /api/repayments/{id}:
 *   get:
 *     summary: Get repayment by ID
 *     tags: [Loan Repayments]
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
 *         description: Repayment details
 *       404:
 *         description: Repayment not found
 */
router.get('/:id', authenticate, loanRepaymentsController.getRepaymentById);

module.exports = router;
