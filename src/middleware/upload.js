const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateSafeFilename, isValidFileType } = require('../models/filesModel');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safeFilename = generateSafeFilename(file.originalname);
    cb(null, safeFilename);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  if (isValidFileType(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
  }
};

// Create multer upload middleware
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Error handling middleware for multer
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'File size must not exceed 5MB'
      });
    }
    return res.status(400).json({
      error: 'Upload error',
      message: err.message
    });
  } else if (err) {
    return res.status(400).json({
      error: 'Upload error',
      message: err.message
    });
  }
  next();
};

module.exports = {
  upload,
  handleUploadError
};
