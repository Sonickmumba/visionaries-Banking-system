const db = require('../config/database');

async function getLoansByCycle(cycleId, filters = {}) {
  let query = `
    SELECT
      l.id, l.member_id, l.cycle_id, l.loan_type, l.amount,
      l.disbursed_date, l.outstanding_balance, l.monthly_interest, l.status,
      m.user_id, u.full_name AS member_name
    FROM loans l
    JOIN members m ON l.member_id = m.id
    JOIN users   u ON m.user_id   = u.id
    WHERE l.cycle_id = $1
  `;
  const params = [cycleId];

  if (filters.status) {
    query += ` AND l.status = $${params.length + 1}`;
    params.push(filters.status);
  }
  if (filters.member_id) {
    query += ` AND l.member_id = $${params.length + 1}`;
    params.push(filters.member_id);
  }

  query += ' ORDER BY l.disbursed_date DESC';
  const result = await db.query(query, params);
  return result.rows;
}

async function getLoanById(loanId) {
  const result = await db.query(
    `SELECT l.*, u.full_name AS member_name
     FROM loans l
     JOIN members m ON l.member_id = m.id
     JOIN users   u ON m.user_id   = u.id
     WHERE l.id = $1`,
    [loanId]
  );
  if (!result.rows[0]) throw new Error('Loan not found');
  return result.rows[0];
}

async function disburseLoan(loanData) {
  const { member_id, cycle_id, loan_type, amount, disbursed_date } = loanData;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT current_month, config FROM cycles WHERE id = $1',
      [cycle_id]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const currentMonth    = cycleResult.rows[0].current_month;
    const config          = cycleResult.rows[0].config;
    const loanInterestRate = config.loanInterestRate || 0.15;
    const monthlyInterest  = parseFloat(amount) * loanInterestRate;

    const loanResult = await client.query(
      `INSERT INTO loans (member_id, cycle_id, loan_type, amount, disbursed_date, outstanding_balance, monthly_interest, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'disbursed')
       RETURNING id, member_id, cycle_id, loan_type, amount, disbursed_date, outstanding_balance, monthly_interest, status`,
      [member_id, cycle_id, loan_type, amount, disbursed_date, amount, monthlyInterest]
    );
    const loan = loanResult.rows[0];

    const memberNameResult = await client.query(
      'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
      [member_id]
    );
    const memberName = memberNameResult.rows[0]?.full_name || '';

    await client.query(
      `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, $3, 'loan_disbursement', $4, $5, $6)`,
      [member_id, cycle_id, currentMonth, amount, disbursed_date,
       `${loan_type} loan disbursed to ${memberName}`]
    );

    const balanceResult = await client.query(
      'SELECT cumulative_borrowing FROM monthly_balances WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
      [member_id, cycle_id, currentMonth]
    );
    const newCumulativeBorrowing =
      parseFloat(balanceResult.rows[0]?.cumulative_borrowing || 0) + parseFloat(amount);

    let complianceStatus = 'never_borrowed';
    if (newCumulativeBorrowing >= 20000) complianceStatus = 'at_or_above_minimum';
    else if (newCumulativeBorrowing > 0)  complianceStatus = 'borrowed_below_minimum';

    await client.query(
      `UPDATE monthly_balances
       SET outstanding_loan      = outstanding_loan + $1,
           cumulative_borrowing  = $2,
           compliance_status     = $3
       WHERE member_id = $4 AND cycle_id = $5 AND month >= $6`,
      [amount, newCumulativeBorrowing, complianceStatus, member_id, cycle_id, currentMonth]
    );

    await client.query('COMMIT');
    return loan;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordLoanRepayment(repaymentData) {
  const { loan_id, principal_amount, interest_amount, date } = repaymentData;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const loanResult = await client.query(
      'SELECT * FROM loans WHERE id = $1',
      [loan_id]
    );
    if (!loanResult.rows[0]) throw new Error('Loan not found');

    const loan = loanResult.rows[0];
    const newOutstandingBalance =
      parseFloat(loan.outstanding_balance) - parseFloat(principal_amount);

    if (newOutstandingBalance < 0) {
      throw new Error('Repayment amount exceeds outstanding balance');
    }

    const newStatus = newOutstandingBalance === 0 ? 'repaid' : 'disbursed';
    await client.query(
      'UPDATE loans SET outstanding_balance = $1, status = $2 WHERE id = $3',
      [newOutstandingBalance, newStatus, loan_id]
    );

    const cycleResult = await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [loan.cycle_id]
    );
    const currentMonth = cycleResult.rows[0]?.current_month;

    const memberNameResult = await client.query(
      'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
      [loan.member_id]
    );
    const memberName = memberNameResult.rows[0]?.full_name || '';

    if (parseFloat(principal_amount) > 0) {
      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'loan_repayment_principal', $4, $5, $6)`,
        [loan.member_id, loan.cycle_id, currentMonth, principal_amount, date,
         `Loan principal repayment by ${memberName}`]
      );
    }
    if (parseFloat(interest_amount) > 0) {
      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'loan_repayment_interest', $4, $5, $6)`,
        [loan.member_id, loan.cycle_id, currentMonth, interest_amount, date,
         `Loan interest payment by ${memberName}`]
      );
    }

    await client.query(
      `UPDATE monthly_balances
       SET outstanding_loan = outstanding_loan - $1
       WHERE member_id = $2 AND cycle_id = $3 AND month >= $4`,
      [principal_amount, loan.member_id, loan.cycle_id, currentMonth]
    );

    await client.query('COMMIT');
    return { loan_id, principal_amount, interest_amount, new_outstanding_balance: newOutstandingBalance, status: newStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getLoansStats(cycleId) {
  const result = await db.query(
    `SELECT
       COUNT(*)                                               AS total_loans,
       COALESCE(SUM(amount), 0)                              AS total_amount_disbursed,
       COALESCE(SUM(outstanding_balance), 0)                 AS total_outstanding,
       COALESCE(SUM(monthly_interest), 0)                    AS total_monthly_interest,
       COUNT(CASE WHEN status = 'disbursed' THEN 1 END)      AS active_loans,
       COUNT(CASE WHEN status = 'repaid'    THEN 1 END)      AS repaid_loans
     FROM loans
     WHERE cycle_id = $1`,
    [cycleId]
  );
  return result.rows[0];
}

module.exports = {
  getLoansByCycle,
  getLoanById,
  disburseLoan,
  recordLoanRepayment,
  getLoansStats
};
