const express = require('express');
const router = express.Router();
const commonInterestController = require('../controllers/commonInterestController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Common Interest
 *   description: Common interest allocation and analysis
 */

/**
 * @swagger
 * /api/common-interest/cycle/{cycleId}/analyze:
 *   get:
 *     summary: Analyze borrowing patterns for common interest allocation
 *     tags: [Common Interest]
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
 *         description: Borrowing pattern analysis with available allocation methods
 *       400:
 *         description: Invalid input
 */
router.get(
  '/cycle/:cycleId/analyze',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').isInt().withMessage('Month is required')
  ]),
  commonInterestController.analyzeBorrowingPatterns
);

/**
 * @swagger
 * /api/common-interest/cycle/{cycleId}/preview:
 *   post:
 *     summary: Preview common interest allocations without saving
 *     tags: [Common Interest]
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
 *               - allocationMethod
 *             properties:
 *               month:
 *                 type: integer
 *               allocationMethod:
 *                 type: string
 *                 enum: [never_borrowed_only, never_borrowed_and_below_minimum, all_members]
 *     responses:
 *       200:
 *         description: Preview of allocations
 *       400:
 *         description: Invalid input
 */
router.post(
  '/cycle/:cycleId/preview',
  authenticate,
  isAdmin,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    body('month').isInt().withMessage('Month is required'),
    body('allocationMethod')
      .isIn(['never_borrowed_only', 'never_borrowed_and_below_minimum', 'all_members'])
      .withMessage('Valid allocation method is required')
  ]),
  commonInterestController.previewAllocations
);

/**
 * @swagger
 * /api/common-interest/cycle/{cycleId}/apply:
 *   post:
 *     summary: Apply common interest allocations (save to database)
 *     tags: [Common Interest]
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
 *               - allocationMethod
 *             properties:
 *               month:
 *                 type: integer
 *               allocationMethod:
 *                 type: string
 *                 enum: [never_borrowed_only, never_borrowed_and_below_minimum, all_members]
 *     responses:
 *       200:
 *         description: Allocations applied successfully
 *       400:
 *         description: Invalid input
 */
router.post(
  '/cycle/:cycleId/apply',
  authenticate,
  isAdmin,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    body('month').isInt().withMessage('Month is required'),
    body('allocationMethod')
      .isIn(['never_borrowed_only', 'never_borrowed_and_below_minimum', 'all_members'])
      .withMessage('Valid allocation method is required')
  ]),
  commonInterestController.applyAllocations
);

/**
 * @swagger
 * /api/common-interest/cycle/{cycleId}:
 *   get:
 *     summary: Get common interest allocations for a cycle and month
 *     tags: [Common Interest]
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
 *         description: List of allocations
 *       400:
 *         description: Invalid input
 */
router.get(
  '/cycle/:cycleId',
  authenticate,
  validate([
    param('cycleId').isInt().withMessage('Valid cycle ID is required'),
    query('month').isInt().withMessage('Month is required')
  ]),
  commonInterestController.getAllocations
);

module.exports = router;
