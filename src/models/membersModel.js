const db = require('../config/database');

async function getAllMembers(cycleId, filters = {}) {
  let query = `
    SELECT
      m.id, m.user_id, m.cycle_id, m.joined_date, m.status,
      u.email, u.full_name, u.phone, u.address,
      mb.savings_principal, mb.accumulated_savings, mb.outstanding_loan,
      mb.cumulative_borrowing, mb.compliance_status
    FROM members m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN monthly_balances mb ON m.id = mb.member_id AND mb.month = (
      SELECT current_month FROM cycles WHERE id = m.cycle_id
    )
    WHERE m.cycle_id = $1
  `;
  const params = [cycleId];

  if (filters.status) {
    query += ` AND m.status = $${params.length + 1}`;
    params.push(filters.status);
  }
  query += ' ORDER BY u.full_name ASC';

  const result = await db.query(query, params);
  return result.rows;
}

async function getMemberById(memberId) {
  const result = await db.query(
    `SELECT
       m.id, m.user_id, m.cycle_id, m.joined_date, m.status,
       u.email, u.full_name, u.phone, u.address,
       c.name AS cycle_name, c.current_month
     FROM members m
     JOIN users  u ON m.user_id   = u.id
     JOIN cycles c ON m.cycle_id  = c.id
     WHERE m.id = $1`,
    [memberId]
  );
  if (!result.rows[0]) throw new Error('Member not found');
  return result.rows[0];
}

async function addMember(memberData) {
  const { user_id, cycle_id, joined_date } = memberData;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const existingResult = await client.query(
      'SELECT id FROM members WHERE user_id = $1 AND cycle_id = $2',
      [user_id, cycle_id]
    );
    if (existingResult.rows[0]) throw new Error('User is already a member of this cycle');

    const memberResult = await client.query(
      `INSERT INTO members (user_id, cycle_id, joined_date, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, user_id, cycle_id, joined_date, status`,
      [user_id, cycle_id, joined_date]
    );
    const member = memberResult.rows[0];

    await client.query(
      'UPDATE cycles SET member_count = member_count + 1 WHERE id = $1',
      [cycle_id]
    );

    const cycleResult = await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [cycle_id]
    );
    const currentMonth = cycleResult.rows[0].current_month;

    await client.query(
      `INSERT INTO monthly_balances (
         member_id, cycle_id, month, savings_principal, accumulated_savings,
         outstanding_loan, cumulative_borrowing, common_interest_due, penalties_due,
         social_fund_paid, membership_fee_paid, compliance_status
       ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, false, false, 'never_borrowed')`,
      [member.id, cycle_id, currentMonth]
    );

    await client.query('COMMIT');
    return member;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateMember(memberId, updateData) {
  const { status } = updateData;
  const result = await db.query(
    `UPDATE members
     SET status = COALESCE($1, status)
     WHERE id = $2
     RETURNING id, user_id, cycle_id, joined_date, status`,
    [status, memberId]
  );
  if (!result.rows[0]) throw new Error('Member not found');
  return result.rows[0];
}

async function getMemberBalance(memberId, month) {
  const result = await db.query(
    'SELECT * FROM monthly_balances WHERE member_id = $1 AND month = $2',
    [memberId, month]
  );
  return result.rows[0] || null;
}

async function getMemberTransactions(memberId, cycleId, filters = {}) {
  let query = `
    SELECT * FROM transactions
    WHERE member_id = $1 AND cycle_id = $2
  `;
  const params = [memberId, cycleId];

  if (filters.month) {
    query += ` AND month = $${params.length + 1}`;
    params.push(filters.month);
  }
  if (filters.type) {
    query += ` AND type = $${params.length + 1}`;
    params.push(filters.type);
  }
  query += ' ORDER BY date DESC, created_at DESC';
  if (filters.limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(filters.limit);
  }

  const result = await db.query(query, params);
  return result.rows;
}

module.exports = {
  getAllMembers,
  getMemberById,
  addMember,
  updateMember,
  getMemberBalance,
  getMemberTransactions
};
