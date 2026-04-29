const { getDashboardData } = require('../models/dashboardModel');

async function getDashboard(req, res, next) {
  try {
    const cycleId = parseInt(req.params.cycleId, 10);
    if (isNaN(cycleId)) return res.status(400).json({ success: false, error: 'Invalid cycle ID' });

    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    if (req.query.month && isNaN(month)) {
      return res.status(400).json({ success: false, error: 'month must be a number' });
    }

    const data = await getDashboardData(cycleId, month);
    res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
}

module.exports = { getDashboard };
