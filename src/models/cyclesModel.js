const db = require('../config/database');

async function getAllCycles() {
  const result = await db.query(
    // Join monthly_balances at the current month so totals reflect the live state.
    // Using GROUP BY c.id (primary key) so PostgreSQL allows selecting all other
    // cycle columns without listing them explicitly in GROUP BY.
    `SELECT
       c.id, c.name, c.start_date, c.end_date, c.current_month, c.status,
       c.config, c.member_count, c.created_at, c.updated_at,
       COALESCE(SUM(mb.accumulated_savings), 0) AS total_savings,
       COALESCE(SUM(mb.outstanding_loan),   0) AS total_loans
     FROM cycles c
     LEFT JOIN monthly_balances mb
            ON mb.cycle_id = c.id AND mb.month = c.current_month
     GROUP BY c.id
     ORDER BY c.created_at DESC`
  );
  return result.rows;
}

async function getCycleById(cycleId) {
  const result = await db.query(
    `SELECT id, name, start_date, end_date, current_month, status, config, member_count, created_at, updated_at
     FROM cycles
     WHERE id = $1`,
    [cycleId]
  );
  if (!result.rows[0]) throw new Error('Cycle not found');
  return result.rows[0];
}

async function getActiveCycle() {
  const result = await db.query(
    `SELECT id, name, start_date, end_date, current_month, status, config, member_count, created_at, updated_at
     FROM cycles
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (!result.rows[0]) throw new Error('No active cycle found');
  return result.rows[0];
}

async function createCycle(cycleData) {
  const { name, start_date, end_date, config } = cycleData;
  const result = await db.query(
    `INSERT INTO cycles (name, start_date, end_date, status, config, current_month, member_count)
     VALUES ($1, $2, $3, 'active', $4, 1, 0)
     RETURNING id, name, start_date, end_date, current_month, status, config, member_count, created_at`,
    [name, start_date, end_date, JSON.stringify(config)]
  );
  return result.rows[0];
}

async function updateCycle(cycleId, updateData) {
  const { name, end_date, status, config } = updateData;
  const fields = [];
  const values = [];
  let p = 1;

  if (name      !== undefined) { fields.push(`name = $${p++}`);                   values.push(name); }
  if (end_date  !== undefined) { fields.push(`end_date = $${p++}`);               values.push(end_date); }
  if (status    !== undefined) { fields.push(`status = $${p++}`);                 values.push(status); }
  if (config    !== undefined) { fields.push(`config = $${p++}`);                 values.push(JSON.stringify(config)); }

  if (fields.length === 0) throw new Error('No fields to update');

  values.push(cycleId);
  const result = await db.query(
    `UPDATE cycles
     SET ${fields.join(', ')}
     WHERE id = $${p}
     RETURNING id, name, start_date, end_date, current_month, status, config, member_count, updated_at`,
    values
  );
  if (!result.rows[0]) throw new Error('Cycle not found');
  return result.rows[0];
}

async function getCycleStats(cycleId) {
  const result = await db.query(
    `SELECT
       COUNT(DISTINCT m.id)                          AS total_members,
       COALESCE(SUM(mb.accumulated_savings), 0)      AS total_savings,
       COALESCE(SUM(mb.outstanding_loan), 0)         AS total_loans_outstanding,
       COALESCE(SUM(mb.penalties_due), 0)            AS total_penalties_due,
       COALESCE(SUM(mb.common_interest_due), 0)      AS total_common_interest_due
     FROM members m
     LEFT JOIN monthly_balances mb ON m.id = mb.member_id AND mb.cycle_id = $1
     WHERE m.cycle_id = $1 AND m.status = 'active'`,
    [cycleId]
  );
  return result.rows[0];
}

module.exports = {
  getAllCycles,
  getCycleById,
  getActiveCycle,
  createCycle,
  updateCycle,
  getCycleStats
};
