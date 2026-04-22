const express = require('express');
const router = express.Router();
const { getDashboard } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { param, query } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Aggregated dashboard data (single round-trip)
 */

/**
 * @swagger
 * /api/dashboard/cycle/{cycleId}:
 *   get:
 *     summary: Get all dashboard data for a cycle and month
 *     description: >
 *       Returns cycle meta, aggregated stats, per-member monthly balances,
 *       declaration counts, and 3 most-recent loans/declarations in a single
 *       repeatable-read transaction.
 *     tags: [Dashboard]
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
 *         description: Defaults to cycle's current_month when omitted
 *     responses:
 *       200:
 *         description: Dashboard aggregate data
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Cycle not found
 */
router.get(
  '/cycle/:cycleId',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').optional().isInt({ min: 1 }).withMessage('month must be a positive integer'),
  ]),
  getDashboard
);

module.exports = router;
