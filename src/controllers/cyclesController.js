const {
  getAllCycles,
  getCycleById,
  getActiveCycle,
  createCycle,
  updateCycle,
  getCycleStats
} = require('../models/cyclesModel');

// GET /api/cycles
async function getAllCyclesHandler(req, res, next) {
  try {
    const cycles = await getAllCycles();
    res.json({ cycles });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/active
async function getActiveCycleHandler(req, res, next) {
  try {
    const cycle = await getActiveCycle();
    if (!cycle) return res.status(404).json({ error: 'No active cycle found' });
    res.json({ cycle });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/:id
async function getCycleByIdHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cycle ID' });

    const cycle = await getCycleById(id);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    res.json({ cycle });
  } catch (error) {
    next(error);
  }
}

// GET /api/cycles/:id/stats
async function getCycleStatsHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cycle ID' });

    const stats = await getCycleStats(id);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
}

// POST /api/cycles
async function createCycleHandler(req, res, next) {
  try {
    const cycle = await createCycle(req.body);
    res.status(201).json({ message: 'Cycle created successfully', cycle });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/cycles/:id
async function updateCycleHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid cycle ID' });

    const cycle = await updateCycle(id, req.body);
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    res.json({ message: 'Cycle updated successfully', cycle });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllCycles:    getAllCyclesHandler,
  getActiveCycle: getActiveCycleHandler,
  getCycleById:   getCycleByIdHandler,
  getCycleStats:  getCycleStatsHandler,
  createCycle:    createCycleHandler,
  updateCycle:    updateCycleHandler
};
