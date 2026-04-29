const path = require('path');
const {
  saveFileMetadata,
  getFileById,
  deleteFile,
  getFilesByUser
} = require('../models/filesModel');

const ADMIN_ROLES = ['admin', 'super_admin'];

function formatFile(file) {
  return {
    id:         file.id,
    fileName:   file.file_name,
    fileType:   file.file_type,
    fileSize:   file.file_size,
    uploadedAt: file.uploaded_at
  };
}

// POST /api/files/upload
async function uploadFile(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { filename, mimetype, size, path: filePath } = req.file;
    const userId = req.user.id;

    const fileMetadata = await saveFileMetadata(filename, filePath, mimetype, size, userId);

    res.status(201).json({
      message: 'File uploaded successfully',
      file: formatFile(fileMetadata)
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/files/:id
async function getFile(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file ID' });

    const file = await getFileById(id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.json({
      ...formatFile(file),
      uploadedBy: { email: file.uploaded_by_email, name: file.uploaded_by_name }
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/files/:id/download
async function downloadFile(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file ID' });

    const file = await getFileById(id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.download(file.file_path, file.file_name, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/files/:id/view
async function viewFile(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file ID' });

    const file = await getFileById(id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type', file.file_type);
    res.setHeader('Content-Disposition', 'inline');

    res.sendFile(path.resolve(file.file_path), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Failed to view file' });
      }
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/files/:id
async function deleteFileHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file ID' });

    const file = await getFileById(id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const isAdmin    = ADMIN_ROLES.includes(req.user.role);
    const isOwner    = file.uploaded_by === req.user.id;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this file' });
    }

    await deleteFile(id);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// GET /api/files/my-files
async function getMyFiles(req, res, next) {
  try {
    const userId = req.user.id;

    const parsedLimit  = req.query.limit  ? parseInt(req.query.limit, 10)  : 50;
    const parsedOffset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    if (isNaN(parsedLimit))  return res.status(400).json({ error: 'limit must be a number' });
    if (isNaN(parsedOffset)) return res.status(400).json({ error: 'offset must be a number' });

    const files = await getFilesByUser(userId, parsedLimit, parsedOffset);

    res.json({
      files:      files.map(formatFile),
      pagination: { limit: parsedLimit, offset: parsedOffset, count: files.length }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadFile,
  getFile,
  downloadFile,
  viewFile,
  deleteFile: deleteFileHandler,
  getMyFiles
};
