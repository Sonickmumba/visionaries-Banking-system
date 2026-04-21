const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authenticate } = require('../middleware/auth');
const { param, query } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Analytics and reporting endpoints
 */

/**
 * @swagger
 * /api/reports/cycle/{cycleId}:
 *   get:
 *     summary: Get comprehensive cycle report
 *     tags: [Reports]
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
 *         description: Specific month (defaults to current month)
 *     responses:
 *       200:
 *         description: Comprehensive cycle report with statistics
 */
router.get(
  '/cycle/:cycleId',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').optional().isInt().withMessage('Month must be an integer')
  ]),
  reportsController.getCycleReport
);

/**
 * @swagger
 * /api/reports/member/{memberId}/cycle/{cycleId}:
 *   get:
 *     summary: Get member financial statement
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Complete financial statement for member
 */
router.get(
  '/member/:memberId/cycle/:cycleId',
  authenticate,
  validate([
    param('memberId').isInt().withMessage('Valid member ID is required'),
    param('cycleId').isInt().withMessage('Valid cycle ID is required')
  ]),
  reportsController.getMemberStatement
);

/**
 * @swagger
 * /api/reports/cycle/{cycleId}/compliance:
 *   get:
 *     summary: Get compliance report
 *     tags: [Reports]
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
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Compliance report with fees and declaration status
 */
router.get(
  '/cycle/:cycleId/compliance',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').isInt().withMessage('Month is required')
  ]),
  reportsController.getComplianceReport
);

/**
 * @swagger
 * /api/reports/cycle/{cycleId}/savings-growth:
 *   get:
 *     summary: Get savings growth report (trend analysis)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Savings growth trend analysis
 */
router.get(
  '/cycle/:cycleId/savings-growth',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required')
  ]),
  reportsController.getSavingsGrowthReport
);

/**
 * @swagger
 * /api/reports/cycle/{cycleId}/loan-portfolio:
 *   get:
 *     summary: Get loan portfolio report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cycleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Loan portfolio analysis with statistics
 */
router.get(
  '/cycle/:cycleId/loan-portfolio',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required')
  ]),
  reportsController.getLoanPortfolioReport
);

module.exports = router;
