const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Visionaries Banking System API' });
});

module.exports = router;
