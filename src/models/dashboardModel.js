const db = require('../config/database');

/**
 * Single-query dashboard aggregate.
 *
 * Returns everything the Dashboard page needs in one round-trip:
 *   - cycle meta
 *   - aggregated stats
 *   - per-member monthly balances (for front-end commonInterestCalculator)
 *   - declaration counts
 *   - 3 most-recent loans
 *   - 3 most-recent declarations
 *
 * All reads execute inside a single repeatable-read transaction so every
 * figure is consistent to the same snapshot.
 */
async function getDashboardData(cycleId, month) {
  const client = await db.pool.connect();
  try {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await client.query('BEGIN READ ONLY');

    // ── 1. Cycle meta ─────────────────────────────────────────────────────
    const cycleResult = await client.query(
      `SELECT id, name, start_date, end_date, current_month, status, config, member_count
       FROM cycles WHERE id = $1`,
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw Object.assign(new Error('Cycle not found'), { statusCode: 404 });
    const cycle = cycleResult.rows[0];
    const cycleConfig = cycle.config || {};

    const resolvedMonth = month || cycle.current_month;

    // ── 2. Aggregated stats for that month ────────────────────────────────
    const [statsResult, activeResult, penaltiesResult] = await Promise.all([
      client.query(
        `SELECT
           COUNT(mb.member_id)                           AS total_members,
           COALESCE(SUM(mb.savings_principal),      0)   AS total_savings_principal,
           COALESCE(SUM(mb.accumulated_savings),    0)   AS total_accumulated_savings,
           COALESCE(SUM(mb.outstanding_loan),       0)   AS total_outstanding_loans,
           COALESCE(SUM(mb.cumulative_borrowing),   0)   AS total_cumulative_borrowing,
           COALESCE(SUM(mb.common_interest_due),    0)   AS total_common_interest_due,
           COALESCE(SUM(mb.penalties_due),          0)   AS total_penalties_due,
           COUNT(mb.member_id) FILTER (WHERE mb.social_fund_paid)    AS social_fund_paid_count,
           COUNT(mb.member_id) FILTER (WHERE mb.membership_fee_paid) AS membership_fee_paid_count
         FROM monthly_balances mb
         JOIN members m ON m.id = mb.member_id
         WHERE mb.cycle_id = $1 AND mb.month = $2 AND m.status = 'active'`,
        [cycleId, resolvedMonth]
      ),
      client.query(
        `SELECT COUNT(*) AS active_members
         FROM members WHERE cycle_id = $1 AND status = 'active'`,
        [cycleId]
      ),
      client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_unpaid_penalties
         FROM penalties
         WHERE cycle_id = $1 AND month = $2 AND status = 'assessed'`,
        [cycleId, resolvedMonth]
      ),
    ]);

    const s = statsResult.rows[0];

    // Compute unborrowed pool using the same formula as the calculator:
    // pool = savingsPrincipal + socialFundCollected + membershipFeesCollected
    // unborrowed = pool - totalLoansDisbursed
    const socialFundPerMember    = parseFloat(cycleConfig.socialFundAmount || 0);
    const membershipFeePerMember = parseFloat(cycleConfig.membershipFee    || 0);
    const totalSocialFund        = socialFundPerMember    * parseInt(s.social_fund_paid_count,    10);
    const totalMembershipFees    = membershipFeePerMember * parseInt(s.membership_fee_paid_count, 10);
    const totalSavingsPrincipal  = parseFloat(s.total_savings_principal);
    const totalOutstandingLoans  = parseFloat(s.total_outstanding_loans);
    const unborrowed             = (totalSavingsPrincipal + totalSocialFund + totalMembershipFees) - totalOutstandingLoans;
    const interestRate           = parseFloat(cycleConfig.interestRate || 0.15);

    const stats = {
      totalMembers:           parseInt(s.total_members, 10),
      activeMembers:          parseInt(activeResult.rows[0].active_members, 10),
      totalSavingsPrincipal,
      totalAccumulatedSavings: parseFloat(s.total_accumulated_savings),
      totalOutstandingLoans,
      totalCumulativeBorrowing: parseFloat(s.total_cumulative_borrowing),
      totalCommonInterestDue:   parseFloat(s.total_common_interest_due),
      totalPenaltiesDue:        parseFloat(penaltiesResult.rows[0].total_unpaid_penalties),
      totalSocialFund,
      totalMembershipFees,
      unborrowed,
      // expose for commonInterestCalculator on the frontend
      socialFundPerMember,
      membershipFeePerMember,
      interestRate,
    };

    // ── 3. Per-member monthly balances (for commonInterestCalculator) ─────
    const balancesResult = await client.query(
      `SELECT
         mb.member_id AS "memberId",
         u.full_name  AS "memberName",
         COALESCE(mb.savings_principal,    0) AS "savingsPrincipal",
         COALESCE(mb.accumulated_savings,  0) AS "accumulatedSavings",
         COALESCE(mb.outstanding_loan,     0) AS "outstandingLoan",
         COALESCE(mb.cumulative_borrowing, 0) AS "cumulativeBorrowing",
         mb.social_fund_paid    AS "socialFundPaid",
         mb.membership_fee_paid AS "membershipFeePaid"
       FROM monthly_balances mb
       JOIN members m ON m.id = mb.member_id
       JOIN users   u ON u.id = m.user_id
       WHERE mb.cycle_id = $1 AND mb.month = $2 AND m.status = 'active'
       ORDER BY u.full_name`,
      [cycleId, resolvedMonth]
    );

    const monthlyBalances = balancesResult.rows.map(r => ({
      memberId:           r.memberId,
      memberName:         r.memberName,
      savingsPrincipal:   parseFloat(r.savingsPrincipal),
      accumulatedSavings: parseFloat(r.accumulatedSavings),
      outstandingLoan:    parseFloat(r.outstandingLoan),
      cumulativeBorrowing: parseFloat(r.cumulativeBorrowing),
      socialFundPaid:     r.socialFundPaid,
      membershipFeePaid:  r.membershipFeePaid,
    }));

    // ── 4. Declaration counts ─────────────────────────────────────────────
    const declCountResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('submitted','approved','processed')) AS submitted,
         COUNT(*) FILTER (WHERE status IN ('approved','processed'))             AS processed,
         COUNT(*) FILTER (WHERE status = 'pending')                             AS pending
       FROM declarations
       WHERE cycle_id = $1 AND month = $2`,
      [cycleId, resolvedMonth]
    );
    const dc = declCountResult.rows[0];
    const declarations = {
      submitted: parseInt(dc.submitted, 10),
      processed: parseInt(dc.processed, 10),
      pending:   parseInt(dc.pending,   10),
      missing:   stats.totalMembers - parseInt(dc.submitted, 10),
    };

    // ── 5. Recent loans (3) ───────────────────────────────────────────────
    const loansResult = await client.query(
      `SELECT
         l.id,
         u.full_name   AS "memberName",
         l.amount,
         l.loan_type   AS "loanType",
         l.status,
         l.disbursed_date AS "disbursedDate"
       FROM loans l
       JOIN members m ON m.id = l.member_id
       JOIN users   u ON u.id = m.user_id
       WHERE l.cycle_id = $1
       ORDER BY l.disbursed_date DESC, l.id DESC
       LIMIT 3`,
      [cycleId]
    );

    // ── 6. Recent declarations (3) ────────────────────────────────────────
    const recentDeclResult = await client.query(
      `SELECT
         d.id,
         u.full_name  AS "memberName",
         d.month,
         d.status,
         d.submitted_at AS "submittedAt",
         d.savings_amount AS "savingsAmount"
       FROM declarations d
       JOIN members m ON m.id = d.member_id
       JOIN users   u ON u.id = m.user_id
       WHERE d.cycle_id = $1
       ORDER BY d.submitted_at DESC, d.id DESC
       LIMIT 3`,
      [cycleId]
    );

    await client.query('COMMIT');

    return {
      cycle: {
        id:           cycle.id,
        name:         cycle.name,
        startDate:    cycle.start_date,
        endDate:      cycle.end_date,
        currentMonth: cycle.current_month,
        status:       cycle.status,
        memberCount:  cycle.member_count,
        interestRate,
        minimumBorrowingAmount: parseFloat(cycleConfig.minimumBorrowingAmount || 20000),
        socialFundAmount:       socialFundPerMember,
        membershipFee:          membershipFeePerMember,
      },
      month:            resolvedMonth,
      stats,
      monthlyBalances,
      declarations,
      recentLoans:         loansResult.rows.map(r => ({ ...r, amount: parseFloat(r.amount) })),
      recentDeclarations:  recentDeclResult.rows.map(r => ({ ...r, savingsAmount: parseFloat(r.savingsAmount) })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getDashboardData };
