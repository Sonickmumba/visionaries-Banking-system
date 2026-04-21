const db = require('../config/database');

async function getPenaltiesByCycle(cycleId, filters = {}) {
  let query = `
    SELECT
      p.id, p.member_id, p.cycle_id, p.month, p.penalty_type,
      p.amount, p.status, p.reason, p.created_at,
      u.full_name AS member_name
    FROM penalties p
    JOIN members m ON p.member_id = m.id
    JOIN users   u ON m.user_id   = u.id
    WHERE p.cycle_id = $1
  `;
  const params = [cycleId];

  if (filters.month) {
    query += ` AND p.month = $${params.length + 1}`;
    params.push(filters.month);
  }
  if (filters.status) {
    query += ` AND p.status = $${params.length + 1}`;
    params.push(filters.status);
  }
  if (filters.member_id) {
    query += ` AND p.member_id = $${params.length + 1}`;
    params.push(filters.member_id);
  }
  query += ' ORDER BY p.created_at DESC';

  const result = await db.query(query, params);
  return result.rows;
}

async function getPenaltyById(penaltyId) {
  const result = await db.query(
    `SELECT p.*, u.full_name AS member_name
     FROM penalties p
     JOIN members m ON p.member_id = m.id
     JOIN users   u ON m.user_id   = u.id
     WHERE p.id = $1`,
    [penaltyId]
  );
  if (!result.rows[0]) throw new Error('Penalty not found');
  return result.rows[0];
}

async function assessPenalty(penaltyData) {
  const { member_id, cycle_id, month, penalty_type, amount, reason } = penaltyData;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const penaltyResult = await client.query(
      `INSERT INTO penalties (member_id, cycle_id, month, penalty_type, amount, status, reason)
       VALUES ($1, $2, $3, $4, $5, 'assessed', $6)
       RETURNING id, member_id, cycle_id, month, penalty_type, amount, status, reason, created_at`,
      [member_id, cycle_id, month, penalty_type, amount, reason]
    );
    const penalty = penaltyResult.rows[0];

    const memberNameResult = await client.query(
      'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
      [member_id]
    );
    const memberName = memberNameResult.rows[0]?.full_name || '';

    await client.query(
      `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, $3, 'penalty_assessment', $4, CURRENT_DATE, $5)`,
      [member_id, cycle_id, month, amount, `${penalty_type} penalty assessed for ${memberName}: ${reason}`]
    );

    await client.query(
      `UPDATE monthly_balances
       SET penalties_due = penalties_due + $1
       WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
      [amount, member_id, cycle_id, month]
    );

    await client.query('COMMIT');
    return penalty;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updatePenaltyStatus(penaltyId, status) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const penaltyResult = await client.query(
      'SELECT * FROM penalties WHERE id = $1',
      [penaltyId]
    );
    if (!penaltyResult.rows[0]) throw new Error('Penalty not found');

    const penalty = penaltyResult.rows[0];

    const updateResult = await client.query(
      `UPDATE penalties
       SET status = $1
       WHERE id = $2
       RETURNING id, member_id, cycle_id, month, penalty_type, amount, status, reason`,
      [status, penaltyId]
    );
    const updatedPenalty = updateResult.rows[0];

    if (status === 'paid' && penalty.status !== 'paid') {
      await client.query(
        `UPDATE monthly_balances
         SET penalties_due = GREATEST(penalties_due - $1, 0)
         WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
        [penalty.amount, penalty.member_id, penalty.cycle_id, penalty.month]
      );

      const memberNameResult = await client.query(
        'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
        [penalty.member_id]
      );
      const memberName = memberNameResult.rows[0]?.full_name || '';

      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'penalty_payment', $4, CURRENT_DATE, $5)`,
        [penalty.member_id, penalty.cycle_id, penalty.month, penalty.amount,
         `Penalty payment by ${memberName}: ${penalty.penalty_type}`]
      );
    }

    await client.query('COMMIT');
    return updatedPenalty;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function assessFailureToDeclarePenalties(cycleId, month) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT config FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const config        = cycleResult.rows[0].config;
    const penaltyAmount = config.failureToDecllarePenalty || 100;

    const membersResult = await client.query(
      `SELECT m.id, u.full_name
       FROM members m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN declarations d ON m.id = d.member_id AND d.cycle_id = $1 AND d.month = $2
       WHERE m.cycle_id = $1 AND m.status = 'active' AND d.id IS NULL`,
      [cycleId, month]
    );

    const penaltiesAssessed = [];

    for (const member of membersResult.rows) {
      const existingResult = await client.query(
        `SELECT id FROM penalties
         WHERE member_id = $1 AND cycle_id = $2 AND month = $3 AND penalty_type = 'failure_to_declare'`,
        [member.id, cycleId, month]
      );
      if (existingResult.rows[0]) continue;

      const penaltyResult = await client.query(
        `INSERT INTO penalties (member_id, cycle_id, month, penalty_type, amount, status, reason)
         VALUES ($1, $2, $3, 'failure_to_declare', $4, 'assessed', 'Did not submit declaration for this month')
         RETURNING id, member_id, cycle_id, month, penalty_type, amount, status, reason`,
        [member.id, cycleId, month, penaltyAmount]
      );
      const penalty = penaltyResult.rows[0];

      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'penalty_assessment', $4, CURRENT_DATE, $5)`,
        [member.id, cycleId, month, penaltyAmount,
         `Failure to declare penalty assessed for ${member.full_name}`]
      );

      await client.query(
        `UPDATE monthly_balances
         SET penalties_due = penalties_due + $1
         WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
        [penaltyAmount, member.id, cycleId, month]
      );

      penaltiesAssessed.push({ ...penalty, member_name: member.full_name });
    }

    await client.query('COMMIT');
    return penaltiesAssessed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getPenaltiesStats(cycleId, month) {
  const result = await db.query(
    `SELECT
       COUNT(*)                                                    AS total_penalties,
       COALESCE(SUM(amount), 0)                                    AS total_amount,
       COUNT(CASE WHEN status = 'assessed'          THEN 1 END)   AS unpaid,
       COUNT(CASE WHEN status = 'paid'              THEN 1 END)   AS paid,
       COUNT(CASE WHEN status = 'waived'            THEN 1 END)   AS waived,
       COUNT(CASE WHEN status = 'converted_to_loan' THEN 1 END)   AS converted
     FROM penalties
     WHERE cycle_id = $1 AND month = $2`,
    [cycleId, month]
  );
  return result.rows[0];
}

module.exports = {
  getPenaltiesByCycle,
  getPenaltyById,
  assessPenalty,
  updatePenaltyStatus,
  assessFailureToDeclarePenalties,
  getPenaltiesStats
};
