const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { authenticate } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');

/**
 * @swagger
 * tags:
 *   name: Files
 *   description: File upload and management endpoints
 */

/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Upload a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: File uploaded successfully
 *       400:
 *         description: Invalid file or no file uploaded
 *       401:
 *         description: Unauthorized
 */
router.post('/upload', authenticate, upload.single('file'), handleUploadError, fileController.uploadFile);

/**
 * @swagger
 * /api/files/my-files:
 *   get:
 *     summary: Get current user's uploaded files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *         description: List of user's files
 *       401:
 *         description: Unauthorized
 */
router.get('/my-files', authenticate, fileController.getMyFiles);

/**
 * @swagger
 * /api/files/{id}:
 *   get:
 *     summary: Get file metadata by ID
 *     tags: [Files]
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
 *         description: File metadata
 *       404:
 *         description: File not found
 */
router.get('/:id', authenticate, fileController.getFile);

/**
 * @swagger
 * /api/files/{id}/download:
 *   get:
 *     summary: Download file
 *     tags: [Files]
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
 *         description: File download
 *       404:
 *         description: File not found
 */
router.get('/:id/download', authenticate, fileController.downloadFile);

/**
 * @swagger
 * /api/files/{id}/view:
 *   get:
 *     summary: View file inline (for images and PDFs)
 *     tags: [Files]
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
 *         description: File content
 *       404:
 *         description: File not found
 */
router.get('/:id/view', authenticate, fileController.viewFile);

/**
 * @swagger
 * /api/files/{id}:
 *   delete:
 *     summary: Delete file
 *     tags: [Files]
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
 *         description: File deleted successfully
 *       403:
 *         description: Unauthorized to delete this file
 *       404:
 *         description: File not found
 */
router.delete('/:id', authenticate, fileController.deleteFile);

module.exports = router;
