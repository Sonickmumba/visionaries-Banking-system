const db   = require('../config/database');
const path = require('path');
const fs   = require('fs').promises;

async function saveFileMetadata(fileName, filePath, fileType, fileSize, userId) {
  const result = await db.query(
    `INSERT INTO uploaded_files (file_name, file_path, file_type, file_size, uploaded_by, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [fileName, filePath, fileType, fileSize, userId]
  );
  return result.rows[0];
}

async function getFileById(fileId) {
  const result = await db.query(
    `SELECT uf.*, u.email AS uploaded_by_email, u.full_name AS uploaded_by_name
     FROM uploaded_files uf
     LEFT JOIN users u ON uf.uploaded_by = u.id
     WHERE uf.id = $1`,
    [fileId]
  );
  return result.rows[0];
}

async function deleteFile(fileId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const fileResult = await client.query(
      'SELECT file_path FROM uploaded_files WHERE id = $1',
      [fileId]
    );
    if (!fileResult.rows[0]) throw new Error('File not found');

    const filePath = fileResult.rows[0].file_path;

    await client.query('DELETE FROM uploaded_files WHERE id = $1', [fileId]);

    // Best-effort physical delete — don't roll back DB record if file is already gone
    try {
      await fs.unlink(filePath);
    } catch (_fsError) {
      // file may already be absent; DB record is already deleted, continue
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isValidFileType(mimetype) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  return allowedTypes.includes(mimetype);
}

function isValidFileSize(size) {
  const maxSize = 5 * 1024 * 1024; // 5 MB
  return size <= maxSize;
}

function generateSafeFilename(originalName) {
  const timestamp = Date.now();
  const random    = Math.random().toString(36).substring(2, 15);
  const ext       = path.extname(originalName);
  const basename  = path.basename(originalName, ext)
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50);
  return `${timestamp}-${random}-${basename}${ext}`;
}

async function getFilesByUser(userId, limit = 50, offset = 0) {
  const result = await db.query(
    `SELECT * FROM uploaded_files
     WHERE uploaded_by = $1
     ORDER BY uploaded_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

async function cleanupOrphanedFiles() {
  const result = await db.query(
    `SELECT uf.id
     FROM uploaded_files uf
     LEFT JOIN declarations   d  ON d.payment_proof_id  = uf.id
     LEFT JOIN loan_repayments lr ON lr.payment_proof_id = uf.id
     WHERE d.id IS NULL AND lr.id IS NULL
     AND uf.uploaded_at < NOW() - INTERVAL '7 days'`
  );

  const deletedIds = [];
  for (const file of result.rows) {
    try {
      await deleteFile(file.id);
      deletedIds.push(file.id);
    } catch (_error) {
      // skip individual failures; continue cleaning remaining files
    }
  }
  return deletedIds;
}

module.exports = {
  saveFileMetadata,
  getFileById,
  deleteFile,
  isValidFileType,
  isValidFileSize,
  generateSafeFilename,
  getFilesByUser,
  cleanupOrphanedFiles
};
