const {
  getDeclarationById,
  getDeclarationsByCycle,
  getMemberDeclaration,
  submitDeclaration,
  updateDeclarationStatus,
  getDeclarationStats,
  getMembersWithoutDeclaration
} = require('../models/declarationsModel');

// const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const VALID_STATUSES = ['pending', 'submitted', 'processed', 'approved', 'rejected'];

function parseCycleMonth(query, res) {
  const cycleId = parseInt(query.cycleId, 10);
  const month   = parseInt(query.month, 10);
  if (!query.cycleId || !query.month) {
    res.status(400).json({ error: 'cycleId and month query parameters are required' });
    return null;
  }
  if (isNaN(cycleId) || isNaN(month)) {
    res.status(400).json({ error: 'cycleId and month must be numbers' });
    return null;
  }
  return { cycleId, month };
}

// GET /api/declarations?cycleId=N&month=N
async function getDeclarationsByCycleHandler(req, res, next) {
  try {
    const parsed = parseCycleMonth(req.query, res);
    if (!parsed) return;

    const declarations = await getDeclarationsByCycle(parsed.cycleId, parsed.month);
    res.json({ declarations });
  } catch (error) {
    next(error);
  }
}

// GET /api/declarations/:id
async function getDeclarationByIdHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid declaration ID' });

    const declaration = await getDeclarationById(id);
    if (!declaration) return res.status(404).json({ error: 'Declaration not found' });

    res.json({ declaration });
  } catch (error) {
    next(error);
  }
}

// GET /api/declarations/member/:memberId?cycleId=N&month=N
async function getMemberDeclarationHandler(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (isNaN(memberId)) return res.status(400).json({ error: 'Invalid member ID' });

    const parsed = parseCycleMonth(req.query, res);
    if (!parsed) return;

    const declaration = await getMemberDeclaration(memberId, parsed.cycleId, parsed.month);
    if (!declaration) return res.status(404).json({ error: 'Declaration not found' });

    res.json({ declaration });
  } catch (error) {
    next(error);
  }
}

// POST /api/declarations
async function submitDeclarationHandler(req, res, next) {
  try {
    const declarationData = { ...req.body, user_id: req.user.id };
    const declaration = await submitDeclaration(declarationData);

    const message = declaration.status === 'pending'
      ? 'Declaration submitted for approval'
      : 'Declaration submitted successfully';

    res.status(201).json({ message, declaration });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/declarations/:id/status
async function updateDeclarationStatusHandler(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid declaration ID' });

    const { status } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const declaration = await updateDeclarationStatus(id, status);
    if (!declaration) return res.status(404).json({ error: 'Declaration not found' });

    res.json({ message: 'Declaration status updated successfully', declaration });
  } catch (error) {
    next(error);
  }
}

// GET /api/declarations/stats?cycleId=N&month=N
async function getDeclarationStatsHandler(req, res, next) {
  try {
    const parsed = parseCycleMonth(req.query, res);
    if (!parsed) return;

    const stats = await getDeclarationStats(parsed.cycleId, parsed.month);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
}

// GET /api/declarations/missing?cycleId=N&month=N
async function getMembersWithoutDeclarationHandler(req, res, next) {
  try {
    const parsed = parseCycleMonth(req.query, res);
    if (!parsed) return;

    const members = await getMembersWithoutDeclaration(parsed.cycleId, parsed.month);
    res.json({ members });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDeclarationsByCycle:       getDeclarationsByCycleHandler,
  getDeclarationById:           getDeclarationByIdHandler,
  getMemberDeclaration:         getMemberDeclarationHandler,
  submitDeclaration:            submitDeclarationHandler,
  updateDeclarationStatus:      updateDeclarationStatusHandler,
  getDeclarationStats:          getDeclarationStatsHandler,
  getMembersWithoutDeclaration: getMembersWithoutDeclarationHandler
};
