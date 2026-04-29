const express = require('express');
const { body } = require('express-validator');
const cyclesController = require('../controllers/cyclesController');
const { authenticate, isAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * /api/cycles:
 *   get:
 *     summary: Get all cycles
 *     tags: [Cycles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all cycles
 */
router.get('/', authenticate, cyclesController.getAllCycles);

/**
 * @swagger
 * /api/cycles/active:
 *   get:
 *     summary: Get active cycle
 *     tags: [Cycles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active cycle details
 */
router.get('/active', authenticate, cyclesController.getActiveCycle);

/**
 * @swagger
 * /api/cycles/{id}:
 *   get:
 *     summary: Get cycle by ID
 *     tags: [Cycles]
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
 *         description: Cycle details
 */
router.get('/:id', authenticate, cyclesController.getCycleById);

/**
 * @swagger
 * /api/cycles/{id}/stats:
 *   get:
 *     summary: Get cycle statistics
 *     tags: [Cycles]
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
 *         description: Cycle statistics
 */
router.get('/:id/stats', authenticate, cyclesController.getCycleStats);

/**
 * @swagger
 * /api/cycles:
 *   post:
 *     summary: Create new cycle (Admin only)
 *     tags: [Cycles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - start_date
 *               - end_date
 *               - config
 *             properties:
 *               name:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               config:
 *                 type: object
 *     responses:
 *       201:
 *         description: Cycle created successfully
 */
router.post(
  '/',
  authenticate,
  isAdmin,
  [
    body('name').trim().notEmpty(),
    body('start_date').isDate(),
    body('end_date').isDate(),
    body('config').isObject(),
  ],
  validate,
  cyclesController.createCycle
);

/**
 * @swagger
 * /api/cycles/{id}:
 *   put:
 *     summary: Update cycle (Admin only)
 *     tags: [Cycles]
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
 *               name:
 *                 type: string
 *               end_date:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [active, completed, cancelled]
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Cycle updated successfully
 */
router.put(
  '/:id',
  authenticate,
  isAdmin,
  [
    body('name').optional().trim().notEmpty(),
    body('end_date').optional().isDate(),
    body('status').optional().isIn(['active', 'completed', 'cancelled']),
    body('config').optional().isObject(),
  ],
  validate,
  cyclesController.updateCycle
);

module.exports = router;
