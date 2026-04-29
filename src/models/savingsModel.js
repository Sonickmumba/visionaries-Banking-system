const db = require('../config/database');

async function getSavingsByCycle(cycleId, month) {
  const result = await db.query(
    `SELECT
       s.id, s.member_id, s.cycle_id, s.month,
       s.principal_deposit, s.total_principal, s.savings_interest, s.accumulated_savings,
       m.user_id, u.full_name AS member_name,
       COALESCE(
         (SELECT SUM(s2.total_principal)
          FROM savings s2
          WHERE s2.member_id = s.member_id AND s2.cycle_id = s.cycle_id),
         0
       ) AS cumulative_principal
     FROM savings s
     JOIN members m ON s.member_id = m.id
     JOIN users   u ON m.user_id   = u.id
     WHERE s.cycle_id = $1 AND s.month = $2
     ORDER BY u.full_name ASC`,
    [cycleId, month]
  );
  return result.rows;
}

async function getMemberSavings(memberId, cycleId) {
  const result = await db.query(
    'SELECT * FROM savings WHERE member_id = $1 AND cycle_id = $2 ORDER BY month ASC',
    [memberId, cycleId]
  );
  return result.rows;
}

async function recordSavingsDeposit(depositData) {
  const { member_id, cycle_id, amount, date } = depositData;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT current_month, config FROM cycles WHERE id = $1',
      [cycle_id]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const currentMonth      = cycleResult.rows[0].current_month;
    const config            = cycleResult.rows[0].config;
    const maxSavings        = config.maxSavings || 30000;

    const savingsResult = await client.query(
      'SELECT * FROM savings WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
      [member_id, cycle_id, currentMonth]
    );

    // Sum of all deposits this member has made across every month in this cycle
    const cycleTotalResult = await client.query(
      'SELECT COALESCE(SUM(total_principal), 0) AS cycle_total FROM savings WHERE member_id = $1 AND cycle_id = $2',
      [member_id, cycle_id]
    );
    const existingCycleTotal = parseFloat(cycleTotalResult.rows[0].cycle_total);

    if (savingsResult.rows[0]) {
      throw new Error(`A savings deposit has already been recorded for this member in month ${currentMonth}. Members can only save once per month.`);
    }

    const newPrincipal = parseFloat(amount);

    if (existingCycleTotal + newPrincipal > maxSavings) {
      throw new Error(`Deposit would exceed the cycle savings cap of K${maxSavings.toLocaleString()}. Remaining: K${(maxSavings - existingCycleTotal).toLocaleString()}`);
    }

    await client.query(
      `INSERT INTO savings (member_id, cycle_id, month, principal_deposit, total_principal, savings_interest, accumulated_savings)
       VALUES ($1, $2, $3, $4, $5, 0, $6)`,
      [member_id, cycle_id, currentMonth, newPrincipal, newPrincipal, newPrincipal]
    );

    const memberNameResult = await client.query(
      'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
      [member_id]
    );
    const memberName = memberNameResult.rows[0]?.full_name || '';

    await client.query(
      `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, $3, 'savings_deposit', $4, $5, $6)`,
      [member_id, cycle_id, currentMonth, amount, date, `Savings deposit by ${memberName}`]
    );

    await client.query(
      `UPDATE monthly_balances
       SET savings_principal   = savings_principal   + $1,
           accumulated_savings = accumulated_savings + $1
       WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
      [newPrincipal, member_id, cycle_id, currentMonth]
    );

    await client.query('COMMIT');
    return { member_id, cycle_id, month: currentMonth, amount, new_total_principal: newPrincipal, new_accumulated: newPrincipal };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getSavingsStats(cycleId, month) {
  const result = await db.query(
    `SELECT
       COUNT(*)                                   AS total_depositors,
       COALESCE(SUM(principal_deposit), 0)        AS total_principal_deposited,
       COALESCE(SUM(total_principal), 0)          AS total_principal,
       COALESCE(SUM(savings_interest), 0)         AS total_interest,
       COALESCE(SUM(accumulated_savings), 0)      AS total_accumulated
     FROM savings
     WHERE cycle_id = $1 AND month = $2`,
    [cycleId, month]
  );
  return result.rows[0];
}

module.exports = {
  getSavingsByCycle,
  getMemberSavings,
  recordSavingsDeposit,
  getSavingsStats
};
