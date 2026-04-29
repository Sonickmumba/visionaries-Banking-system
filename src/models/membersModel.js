const db = require('../config/database');

async function getAllMembers(cycleId, filters = {}) {
  let query = `
    SELECT
      m.id, m.user_id, m.cycle_id, m.joined_date, m.status,
      u.email, u.full_name, u.phone, u.address,
      mb.savings_principal, mb.accumulated_savings, mb.outstanding_loan,
      mb.cumulative_borrowing, mb.common_interest_due,
      mb.social_fund_paid, mb.membership_fee_paid, mb.compliance_status
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

/**
 * Enroll a brand-new person as a member:
 *  1. If a user with this email already exists, use them.
 *  2. Otherwise INSERT into users with a placeholder password hash
 *     (they must reset their password on first login).
 *  3. INSERT into members for the given cycle.
 *  4. Initialise monthly_balances for the current month.
 *
 * All steps run in a single transaction.
 */
async function enrollMember({ full_name, email, phone, address, cycle_id, joined_date }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve or create user
    let userRow = (await client.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    let temporaryPassword = null; // only set for brand-new accounts

    if (!userRow) {
      const bcrypt = require('bcryptjs');
      const crypto = require('crypto');
      // Readable temporary password: e.g. "Visio-a3f8b2"
      temporaryPassword = 'Visio-' + crypto.randomBytes(3).toString('hex');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      userRow = (await client.query(
        `INSERT INTO users (email, password_hash, full_name, phone, address, role, status)
         VALUES ($1, $2, $3, $4, $5, 'member', 'active')
         RETURNING id`,
        [email.trim().toLowerCase(), passwordHash, full_name, phone, address]
      )).rows[0];
    }

    // Guard: already a member of this cycle
    const exists = await client.query(
      'SELECT id FROM members WHERE user_id = $1 AND cycle_id = $2',
      [userRow.id, cycle_id]
    );
    if (exists.rows[0]) throw new Error('Member already exists in this cycle');

    // Add to members
    const memberRow = (await client.query(
      `INSERT INTO members (user_id, cycle_id, joined_date, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, user_id, cycle_id, joined_date, status`,
      [userRow.id, cycle_id, joined_date]
    )).rows[0];

    // Bump cycle member_count
    await client.query(
      'UPDATE cycles SET member_count = member_count + 1 WHERE id = $1',
      [cycle_id]
    );

    // Initialise balance for the current month
    const { current_month } = (await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [cycle_id]
    )).rows[0];

    await client.query(
      `INSERT INTO monthly_balances (
         member_id, cycle_id, month, savings_principal, accumulated_savings,
         outstanding_loan, cumulative_borrowing, common_interest_due, penalties_due,
         social_fund_paid, membership_fee_paid, compliance_status
       ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, false, false, 'never_borrowed')`,
      [memberRow.id, cycle_id, current_month]
    );

    await client.query('COMMIT');
    return { ...memberRow, temporaryPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List users with role='member' and status='pending'.
 * These are people who registered but haven't been enrolled in any cycle yet.
 */
async function getPendingUsers() {
  const result = await db.query(`
    SELECT id, email, full_name, phone, address, created_at
    FROM   users
    WHERE  role   = 'member'
      AND  status = 'pending'
    ORDER  BY created_at ASC
  `);
  return result.rows;
}

/**
 * Approve a pending user and enroll them into the given cycle.
 *  1. Validates user exists and is pending.
 *  2. Sets user.status = 'active'.
 *  3. Creates the members row.
 *  4. Initialises monthly_balances for current month.
 *  5. Bumps cycle member_count.
 * All steps run in a single transaction.
 */
async function approveAndEnroll({ user_id, cycle_id, joined_date }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Validate user
    const userResult = await client.query(
      `SELECT id, status, role FROM users WHERE id = $1`,
      [user_id]
    );
    const user = userResult.rows[0];
    if (!user) throw new Error('User not found');
    if (user.status !== 'pending') throw new Error('User is not in pending status');

    // Guard duplicate enrollment
    const existsResult = await client.query(
      'SELECT id FROM members WHERE user_id = $1 AND cycle_id = $2',
      [user_id, cycle_id]
    );
    if (existsResult.rows[0]) throw new Error('Member already exists in this cycle');

    // Activate user
    await client.query(
      `UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [user_id]
    );

    // Create member row
    const memberResult = await client.query(
      `INSERT INTO members (user_id, cycle_id, joined_date, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, user_id, cycle_id, joined_date, status`,
      [user_id, cycle_id, joined_date]
    );
    const member = memberResult.rows[0];

    // Bump cycle member_count
    await client.query(
      'UPDATE cycles SET member_count = member_count + 1 WHERE id = $1',
      [cycle_id]
    );

    // Initialise monthly_balances for current month
    const cycleResult = await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [cycle_id]
    );
    const { current_month } = cycleResult.rows[0];

    await client.query(
      `INSERT INTO monthly_balances (
         member_id, cycle_id, month, savings_principal, accumulated_savings,
         outstanding_loan, cumulative_borrowing, common_interest_due, penalties_due,
         social_fund_paid, membership_fee_paid, compliance_status
       ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, false, false, 'never_borrowed')`,
      [member.id, cycle_id, current_month]
    );

    await client.query('COMMIT');
    return member;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record a social fund or membership fee payment for a member.
 * Enforced in month 1 only. Idempotent — throws if already paid.
 */
async function recordFeePayment(memberId, cycleId, feeType, paymentDate) {
  const column = feeType === 'social_fund' ? 'social_fund_paid' : 'membership_fee_paid';
  const txType = feeType === 'social_fund' ? 'social_fund_payment' : 'membership_fee_payment';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verify member belongs to cycle
    const memberResult = await client.query(
      'SELECT m.id, m.cycle_id FROM members m WHERE m.id = $1 AND m.cycle_id = $2 AND m.status = $3',
      [memberId, cycleId, 'active']
    );
    if (!memberResult.rows[0]) throw new Error('Member not found in cycle');

    // Fetch cycle: must be month 1 + get fee amount from config
    const cycleResult = await client.query(
      'SELECT current_month, config FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const { current_month, config } = cycleResult.rows[0];
    if (current_month !== 1) {
      throw new Error('Fee payments can only be recorded in month 1 of the cycle');
    }

    const amount = feeType === 'social_fund'
      ? (config.socialFund || config.socialFundAmount || 0)
      : (config.membershipFee || 0);

    // Idempotency check — must be month 1 row
    const balResult = await client.query(
      `SELECT ${column} FROM monthly_balances WHERE member_id = $1 AND cycle_id = $2 AND month = 1`,
      [memberId, cycleId]
    );
    if (!balResult.rows[0]) throw new Error('Monthly balance record not found for month 1');
    if (balResult.rows[0][column]) throw new Error('Fee already recorded as paid');

    // Mark paid — update ALL months (carries forward like processMonthEnd does)
    await client.query(
      `UPDATE monthly_balances SET ${column} = true WHERE member_id = $1 AND cycle_id = $2`,
      [memberId, cycleId]
    );

    // Record transaction
    await client.query(
      `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [memberId, cycleId, txType, amount, paymentDate,
       `${feeType === 'social_fund' ? 'Social fund' : 'Membership fee'} payment recorded for member #${memberId}`]
    );

    await client.query('COMMIT');
    return { memberId, cycleId, feeType, amount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getAllMembers,
  getMemberById,
  addMember,
  enrollMember,
  updateMember,
  getMemberBalance,
  getMemberTransactions,
  getPendingUsers,
  approveAndEnroll,
  recordFeePayment,
};
