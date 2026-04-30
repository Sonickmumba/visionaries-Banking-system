const db = require('../config/database');

async function processMonthEnd(cycleId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT * FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const cycle        = cycleResult.rows[0];
    const currentMonth = cycle.current_month;
    const nextMonth    = currentMonth + 1;
    const interestRate = cycle.config.interestRate || cycle.config.commonInterestRate || cycle.config.savingsInterestRate || 0.15;

    const startDate = new Date(cycle.start_date);
    const endDate   = new Date(cycle.end_date);
    const monthsDiff =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth()) + 1;

    if (nextMonth > monthsDiff) {
      throw new Error('Cannot advance beyond cycle end date');
    }

    const membersResult = await client.query(
      'SELECT id FROM members WHERE cycle_id = $1 AND status = $2',
      [cycleId, 'active']
    );
    const members = membersResult.rows;

    for (const { id: memberId } of members) {
      const balanceResult = await client.query(
        'SELECT * FROM monthly_balances WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
        [memberId, cycleId, currentMonth]
      );

      const currentBalance = balanceResult.rows[0] || {
        savings_principal: 0, accumulated_savings: 0, outstanding_loan: 0,
        cumulative_borrowing: 0, common_interest_due: 0, penalties_due: 0,
        social_fund_paid: false, membership_fee_paid: false
      };

      const savingsInterest     = parseFloat(currentBalance.accumulated_savings || 0) * interestRate;
      const newAccumulatedSavings = parseFloat(currentBalance.accumulated_savings || 0) + savingsInterest;

      // ── Compound each active loan and accumulate total interest accrued ──
      // NOTE: 'common_interest_pool' loans are Option-B non-compounding loans
      // (monthly_interest=0). They must NOT have their monthly_interest recalculated
      // or they would silently start compounding. We use loan_type to guard them.
      const activeLoansResult = await client.query(
        `SELECT id, loan_type, outstanding_balance, monthly_interest
         FROM loans
         WHERE member_id = $1 AND cycle_id = $2 AND status IN ('disbursed', 'approved')`,
        [memberId, cycleId]
      );
      const activeLoans = activeLoansResult.rows;

      let loanInterest        = 0;
      let totalNewOutstanding = 0;

      for (const loan of activeLoans) {
        const outstanding        = parseFloat(loan.outstanding_balance);
        const isPoolLoan         = loan.loan_type === 'common_interest_pool';
        // Pool loans never compound — keep interest at 0
        const interest           = isPoolLoan ? 0 : parseFloat(loan.monthly_interest);
        const newOutstanding     = outstanding + interest;
        const newMonthlyInterest = isPoolLoan ? 0 : newOutstanding * interestRate;

        await client.query(
          `UPDATE loans
           SET outstanding_balance = $1,
               monthly_interest    = $2,
               updated_at          = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [newOutstanding, newMonthlyInterest, loan.id]
        );

        loanInterest        += interest;
        totalNewOutstanding += newOutstanding;
      }

      await client.query(
        `INSERT INTO monthly_balances (
           member_id, cycle_id, month,
           savings_principal, accumulated_savings,
           outstanding_loan, cumulative_borrowing,
           common_interest_due, penalties_due,
           social_fund_paid, membership_fee_paid,
           compliance_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (member_id, cycle_id, month) DO NOTHING`,
        [
          memberId, cycleId, nextMonth,
          currentBalance.savings_principal     || 0,
          newAccumulatedSavings,
          totalNewOutstanding,   // sum of all active loans compounded; 0 if no active loans
          currentBalance.cumulative_borrowing  || 0,
          currentBalance.common_interest_due   || 0, // carry forward — member still owes this next month
          0,                                         // penalties_due reset — fresh each month
          currentBalance.social_fund_paid      || false,
          currentBalance.membership_fee_paid   || false,
          currentBalance.compliance_status     || 'never_borrowed'
        ]
      );

      // Write the finalised interest and end-of-month accumulated value back to
      // the savings row for the month just closed so the frontend shows real data.
      await client.query(
        `UPDATE savings
         SET savings_interest   = $1,
             accumulated_savings = $2
         WHERE member_id = $3 AND cycle_id = $4 AND month = $5`,
        [savingsInterest, newAccumulatedSavings, memberId, cycleId, currentMonth]
      );

      if (savingsInterest > 0) {
        await client.query(
          `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
           VALUES ($1, $2, $3, 'savings_interest', $4, $5, $6)`,
          [memberId, cycleId, nextMonth, savingsInterest, new Date(),
           `Savings interest for month ${currentMonth} (${(interestRate * 100).toFixed(0)}% compound)`]
        );
      }
      if (loanInterest > 0) {
        await client.query(
          `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
           VALUES ($1, $2, $3, 'loan_interest', $4, $5, $6)`,
          [memberId, cycleId, nextMonth, loanInterest, new Date(),
           `Loan interest for month ${currentMonth} (${(interestRate * 100).toFixed(0)}%)`]
        );
      }
    }

    await client.query(
      'UPDATE cycles SET current_month = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [nextMonth, cycleId]
    );

    await client.query('COMMIT');
    return { cycleId, previousMonth: currentMonth, newMonth: nextMonth, membersProcessed: members.length, interestRate };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getMonthEndSummary(cycleId, month) {
  const client = await db.pool.connect();
  try {
    const cycleResult = await client.query(
      'SELECT * FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const cycle = cycleResult.rows[0];

    const summaryResult = await client.query(
      `SELECT
         COUNT(DISTINCT mb.member_id)              AS total_members,
         COALESCE(SUM(mb.savings_principal), 0)    AS total_principal,
         COALESCE(SUM(mb.accumulated_savings), 0)  AS total_accumulated_savings,
         COALESCE(SUM(mb.outstanding_loan), 0)     AS total_outstanding_loans,
         COALESCE(SUM(mb.cumulative_borrowing), 0) AS total_cumulative_borrowing,
         COALESCE(SUM(mb.common_interest_due), 0)  AS total_common_interest_due,
         COALESCE(SUM(mb.penalties_due), 0)        AS total_penalties_due
       FROM monthly_balances mb
       WHERE mb.cycle_id = $1 AND mb.month = $2`,
      [cycleId, month]
    );
    const summary = summaryResult.rows[0];

    const interestRate          = cycle.config.interestRate || cycle.config.commonInterestRate || cycle.config.savingsInterestRate || 0.15;
    const savingsInterestToApply = parseFloat(summary.total_accumulated_savings) * interestRate;

    const declarationResult = await client.query(
      `SELECT
         COUNT(*)                                            AS total_declarations,
         COUNT(*) FILTER (WHERE status = 'processed')       AS processed_declarations,
         COUNT(*) FILTER (WHERE status = 'submitted')       AS pending_declarations
       FROM declarations
       WHERE cycle_id = $1 AND month = $2`,
      [cycleId, month]
    );

    const missingResult = await client.query(
      `SELECT COUNT(*) AS missing_count
       FROM members m
       WHERE m.cycle_id = $1 AND m.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM declarations d
           WHERE d.member_id = m.id AND d.cycle_id = $1 AND d.month = $2
         )`,
      [cycleId, month]
    );

    const declarationStats  = declarationResult.rows[0];
    const missingDeclarations = parseInt(missingResult.rows[0].missing_count, 10);

    return {
      cycleId,
      cycleName: cycle.name,
      currentMonth: month,
      nextMonth: month + 1,
      interestRate,
      totalMembers: parseInt(summary.total_members, 10),
      totalPrincipal: parseFloat(summary.total_principal),
      totalAccumulatedSavings: parseFloat(summary.total_accumulated_savings),
      savingsInterestToApply,
      totalOutstandingLoans: parseFloat(summary.total_outstanding_loans),
      totalCumulativeBorrowing: parseFloat(summary.total_cumulative_borrowing),
      totalCommonInterestDue: parseFloat(summary.total_common_interest_due),
      totalPenaltiesDue: parseFloat(summary.total_penalties_due),
      declarations: {
        total:     parseInt(declarationStats.total_declarations, 10),
        processed: parseInt(declarationStats.processed_declarations, 10),
        pending:   parseInt(declarationStats.pending_declarations, 10),
        missing:   missingDeclarations
      }
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackMonth(cycleId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const currentMonth = cycleResult.rows[0].current_month;
    if (currentMonth <= 1) throw new Error('Cannot rollback from month 1');

    const previousMonth = currentMonth - 1;

    await client.query(
      'DELETE FROM monthly_balances WHERE cycle_id = $1 AND month = $2',
      [cycleId, currentMonth]
    );
    await client.query(
      'DELETE FROM transactions WHERE cycle_id = $1 AND month = $2',
      [cycleId, currentMonth]
    );
    await client.query(
      'DELETE FROM common_interest_allocations WHERE cycle_id = $1 AND month = $2',
      [cycleId, currentMonth]
    );
    await client.query(
      'UPDATE cycles SET current_month = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [previousMonth, cycleId]
    );

    await client.query('COMMIT');
    return { cycleId, rolledBackFrom: currentMonth, currentMonth: previousMonth };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  processMonthEnd,
  getMonthEndSummary,
  rollbackMonth
};
