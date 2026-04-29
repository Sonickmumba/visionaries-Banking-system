const express = require('express');
const router = express.Router();
const approvalsController = require('../controllers/approvalsController');
const { authenticate, isAdmin } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Approvals
 *   description: Approval management endpoints
 */

/**
 * @swagger
 * /api/approvals/stats:
 *   get:
 *     summary: Get approval statistics
 *     tags: [Approvals]
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
 *         description: Approval statistics
 *       400:
 *         description: Missing cycleId
 *       401:
 *         description: Unauthorized
 */
router.get('/stats', authenticate, approvalsController.getApprovalStats);

/**
 * @swagger
 * /api/approvals:
 *   get:
 *     summary: Get all approvals with filters
 *     tags: [Approvals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cycleId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, savings_declaration, loan_repayment]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, all]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of approvals
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, approvalsController.getApprovals);

/**
 * @swagger
 * /api/approvals/{id}:
 *   get:
 *     summary: Get approval by ID
 *     tags: [Approvals]
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
 *         description: Approval details
 *       404:
 *         description: Approval not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:id', authenticate, approvalsController.getApprovalById);

/**
 * @swagger
 * /api/approvals/savings/{id}/approve:
 *   patch:
 *     summary: Approve a savings declaration (Admin only)
 *     tags: [Approvals]
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
 *         description: Savings declaration approved
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/savings/:id/approve', authenticate, isAdmin, approvalsController.approveSavingsDeclaration);

/**
 * @swagger
 * /api/approvals/savings/{id}/reject:
 *   patch:
 *     summary: Reject a savings declaration (Admin only)
 *     tags: [Approvals]
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
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Savings declaration rejected
 *       400:
 *         description: Missing rejection reason
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/savings/:id/reject', authenticate, isAdmin, approvalsController.rejectSavingsDeclaration);

/**
 * @swagger
 * /api/approvals/repayments/{id}/approve:
 *   patch:
 *     summary: Approve a loan repayment (Admin only)
 *     tags: [Approvals]
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
 *         description: Loan repayment approved
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/repayments/:id/approve', authenticate, isAdmin, approvalsController.approveLoanRepayment);

/**
 * @swagger
 * /api/approvals/repayments/{id}/reject:
 *   patch:
 *     summary: Reject a loan repayment (Admin only)
 *     tags: [Approvals]
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
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan repayment rejected
 *       400:
 *         description: Missing rejection reason
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/repayments/:id/reject', authenticate, isAdmin, approvalsController.rejectLoanRepayment);

/**
 * @swagger
 * /api/approvals/loan-requests/{id}/approve:
 *   patch:
 *     summary: Approve a loan request (Admin only)
 *     tags: [Approvals]
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
 *         description: Loan request approved and loan created
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/loan-requests/:id/approve', authenticate, isAdmin, approvalsController.approveLoanRequest);

/**
 * @swagger
 * /api/approvals/loan-requests/{id}/reject:
 *   patch:
 *     summary: Reject a loan request (Admin only)
 *     tags: [Approvals]
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
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan request rejected
 *       400:
 *         description: Missing rejection reason
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Approval not found
 */
router.patch('/loan-requests/:id/reject', authenticate, isAdmin, approvalsController.rejectLoanRequest);

module.exports = router;
