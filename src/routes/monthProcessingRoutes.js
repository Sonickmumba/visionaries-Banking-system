const express = require('express');
const router = express.Router();
const monthProcessingController = require('../controllers/monthProcessingController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { param, query } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Month Processing
 *   description: Month-end processing and cycle advancement
 */

/**
 * @swagger
 * /api/month-processing/cycle/{cycleId}/summary:
 *   get:
 *     summary: Get month-end summary
 *     tags: [Month Processing]
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
 *         description: Month-end summary with totals and statistics
 *       400:
 *         description: Invalid input
 */
router.get(
  '/cycle/:cycleId/summary',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').isInt().withMessage('Month is required')
  ]),
  monthProcessingController.getMonthEndSummary
);

/**
 * @swagger
 * /api/month-processing/cycle/{cycleId}/process:
 *   post:
 *     summary: Process month-end and advance to next month
 *     description: Applies compound interest to savings, carries forward balances, and advances cycle to next month
 *     tags: [Month Processing]
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
 *         description: Month-end processing completed
 *       400:
 *         description: Invalid input or cannot advance beyond cycle end
 */
router.post(
  '/cycle/:cycleId/process',
  authenticate,
  isAdmin,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required')
  ]),
  monthProcessingController.processMonthEnd
);

/**
 * @swagger
 * /api/month-processing/cycle/{cycleId}/rollback:
 *   post:
 *     summary: Rollback to previous month (emergency function)
 *     description: Deletes all data for current month and reverts cycle to previous month. Use with caution!
 *     tags: [Month Processing]
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
 *         description: Month rollback completed
 *       400:
 *         description: Cannot rollback from month 1
 */
router.post(
  '/cycle/:cycleId/rollback',
  authenticate,
  isAdmin,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required')
  ]),
  monthProcessingController.rollbackMonth
);

module.exports = router;
