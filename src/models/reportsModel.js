const db = require('../config/database');

async function getCycleReport(cycleId, month = null) {
  const client = await db.pool.connect();
  try {
    const cycleResult = await client.query(
      'SELECT * FROM cycles WHERE id = $1',
      [cycleId]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const cycle       = cycleResult.rows[0];
    const targetMonth = month || cycle.current_month;

    const statsResult = await client.query(
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
      [cycleId, targetMonth]
    );

    const transactionSummary = await client.query(
      `SELECT type, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount
       FROM transactions
       WHERE cycle_id = $1 AND month = $2
       GROUP BY type
       ORDER BY type`,
      [cycleId, targetMonth]
    );

    const loanStats = await client.query(
      `SELECT
         loan_type,
         COUNT(*) AS count,
         COALESCE(SUM(amount), 0)              AS total_amount,
         COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
       FROM loans
       WHERE cycle_id = $1 AND status IN ('disbursed', 'approved')
       GROUP BY loan_type`,
      [cycleId]
    );

    const stats = statsResult.rows[0];
    return {
      cycle: {
        id: cycle.id, name: cycle.name,
        startDate: cycle.start_date, endDate: cycle.end_date,
        currentMonth: cycle.current_month, status: cycle.status, memberCount: cycle.member_count
      },
      month: targetMonth,
      summary: {
        totalMembers:            parseInt(stats.total_members, 10),
        totalPrincipal:          parseFloat(stats.total_principal),
        totalAccumulatedSavings: parseFloat(stats.total_accumulated_savings),
        totalOutstandingLoans:   parseFloat(stats.total_outstanding_loans),
        totalCumulativeBorrowing: parseFloat(stats.total_cumulative_borrowing),
        totalCommonInterestDue:  parseFloat(stats.total_common_interest_due),
        totalPenaltiesDue:       parseFloat(stats.total_penalties_due)
      },
      transactions: transactionSummary.rows.map(r => ({
        type: r.type, count: parseInt(r.count, 10), totalAmount: parseFloat(r.total_amount)
      })),
      loans: loanStats.rows.map(r => ({
        loanType: r.loan_type, count: parseInt(r.count, 10),
        totalAmount: parseFloat(r.total_amount), totalOutstanding: parseFloat(r.total_outstanding)
      }))
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function getMemberStatement(memberId, cycleId) {
  const client = await db.pool.connect();
  try {
    const memberResult = await client.query(
      `SELECT m.*, u.full_name, u.email, u.phone, c.name AS cycle_name
       FROM members m
       JOIN users  u ON m.user_id  = u.id
       JOIN cycles c ON m.cycle_id = c.id
       WHERE m.id = $1 AND m.cycle_id = $2`,
      [memberId, cycleId]
    );
    if (!memberResult.rows[0]) throw new Error('Member not found in this cycle');

    const member = memberResult.rows[0];

    const [balancesResult, transactionsResult, loansResult, penaltiesResult, commonInterestResult] =
      await Promise.all([
        client.query('SELECT * FROM monthly_balances WHERE member_id = $1 AND cycle_id = $2 ORDER BY month', [memberId, cycleId]),
        client.query('SELECT * FROM transactions WHERE member_id = $1 AND cycle_id = $2 ORDER BY date DESC, id DESC', [memberId, cycleId]),
        client.query('SELECT * FROM loans WHERE member_id = $1 AND cycle_id = $2 ORDER BY disbursed_date DESC', [memberId, cycleId]),
        client.query('SELECT * FROM penalties WHERE member_id = $1 AND cycle_id = $2 ORDER BY month DESC', [memberId, cycleId]),
        client.query('SELECT * FROM common_interest_allocations WHERE member_id = $1 AND cycle_id = $2 ORDER BY month DESC', [memberId, cycleId])
      ]);

    return {
      member: {
        id: member.id, fullName: member.full_name, email: member.email, phone: member.phone,
        cycleName: member.cycle_name, joinedDate: member.joined_date, status: member.status
      },
      monthlyBalances:            balancesResult.rows,
      transactions:               transactionsResult.rows,
      loans:                      loansResult.rows,
      penalties:                  penaltiesResult.rows,
      commonInterestAllocations:  commonInterestResult.rows
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function getComplianceReport(cycleId, month) {
  const client = await db.pool.connect();
  try {
    const complianceResult = await client.query(
      `SELECT
         m.id AS member_id,
         u.full_name,
         mb.social_fund_paid,
         mb.membership_fee_paid,
         mb.compliance_status,
         CASE WHEN d.id IS NOT NULL THEN true ELSE false END AS has_declared,
         d.status AS declaration_status,
         COALESCE(mb.penalties_due, 0)       AS penalties_due,
         COALESCE(mb.common_interest_due, 0) AS common_interest_due
       FROM members m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN monthly_balances mb ON mb.member_id = m.id AND mb.cycle_id = $1 AND mb.month = $2
       LEFT JOIN declarations d      ON d.member_id  = m.id AND d.cycle_id  = $1 AND d.month  = $2
       WHERE m.cycle_id = $1 AND m.status = 'active'
       ORDER BY u.full_name`,
      [cycleId, month]
    );

    const members        = complianceResult.rows;
    const totalMembers   = members.length;
    const socialFundPaid = members.filter(m => m.social_fund_paid).length;
    const membershipFeePaid = members.filter(m => m.membership_fee_paid).length;
    const declared       = members.filter(m => m.has_declared).length;
    const withPenalties  = members.filter(m => parseFloat(m.penalties_due) > 0).length;

    return {
      cycleId, month,
      summary: {
        totalMembers, socialFundPaid, membershipFeePaid, declared,
        notDeclared: totalMembers - declared, withPenalties,
        complianceRate: totalMembers > 0 ? ((declared / totalMembers) * 100).toFixed(2) : 0
      },
      members: members.map(m => ({
        memberId:           m.member_id,
        fullName:           m.full_name,
        socialFundPaid:     m.social_fund_paid,
        membershipFeePaid:  m.membership_fee_paid,
        hasDeclared:        m.has_declared,
        declarationStatus:  m.declaration_status,
        penaltiesDue:       parseFloat(m.penalties_due),
        commonInterestDue:  parseFloat(m.common_interest_due),
        complianceStatus:   m.compliance_status
      }))
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function getSavingsGrowthReport(cycleId) {
  const client = await db.pool.connect();
  try {
    const growthResult = await client.query(
      `SELECT
         month,
         COUNT(DISTINCT member_id)             AS active_members,
         COALESCE(SUM(savings_principal), 0)   AS total_principal,
         COALESCE(SUM(accumulated_savings), 0) AS total_accumulated,
         COALESCE(AVG(accumulated_savings), 0) AS avg_per_member
       FROM monthly_balances
       WHERE cycle_id = $1
       GROUP BY month
       ORDER BY month`,
      [cycleId]
    );

    const monthlyData = growthResult.rows.map(r => ({
      month:          r.month,
      activeMembers:  parseInt(r.active_members, 10),
      totalPrincipal: parseFloat(r.total_principal),
      totalAccumulated: parseFloat(r.total_accumulated),
      avgPerMember:   parseFloat(r.avg_per_member)
    }));

    const growthRates = [];
    for (let i = 1; i < monthlyData.length; i++) {
      const cur  = monthlyData[i];
      const prev = monthlyData[i - 1];
      const growthRate = prev.totalAccumulated > 0
        ? ((cur.totalAccumulated - prev.totalAccumulated) / prev.totalAccumulated * 100).toFixed(2)
        : 0;
      growthRates.push({
        month: cur.month,
        growthRate: parseFloat(growthRate),
        absoluteGrowth: cur.totalAccumulated - prev.totalAccumulated
      });
    }

    return { cycleId, monthlyData, growthRates };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function getLoanPortfolioReport(cycleId) {
  const client = await db.pool.connect();
  try {
    const [statsResult, byTypeResult, topBorrowersResult] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*)                                               AS total_loans,
           COALESCE(SUM(amount), 0)                              AS total_disbursed,
           COALESCE(SUM(outstanding_balance), 0)                 AS total_outstanding,
           COALESCE(SUM(monthly_interest), 0)                    AS total_monthly_interest,
           COUNT(*) FILTER (WHERE status = 'disbursed')          AS active_loans,
           COUNT(*) FILTER (WHERE status = 'repaid')             AS repaid_loans,
           COUNT(*) FILTER (WHERE status = 'defaulted')          AS defaulted_loans
         FROM loans WHERE cycle_id = $1`,
        [cycleId]
      ),
      client.query(
        `SELECT loan_type,
           COUNT(*) AS count,
           COALESCE(SUM(amount), 0)              AS total_amount,
           COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
         FROM loans WHERE cycle_id = $1
         GROUP BY loan_type ORDER BY loan_type`,
        [cycleId]
      ),
      client.query(
        `SELECT m.id AS member_id, u.full_name,
           COUNT(l.id)                       AS loan_count,
           COALESCE(SUM(l.amount), 0)        AS total_borrowed,
           COALESCE(SUM(l.outstanding_balance), 0) AS total_outstanding
         FROM members m
         JOIN users u ON m.user_id = u.id
         JOIN loans l ON l.member_id = m.id
         WHERE m.cycle_id = $1
         GROUP BY m.id, u.full_name
         ORDER BY total_borrowed DESC
         LIMIT 10`,
        [cycleId]
      )
    ]);

    const stats = statsResult.rows[0];
    return {
      cycleId,
      summary: {
        totalLoans:          parseInt(stats.total_loans, 10),
        totalDisbursed:      parseFloat(stats.total_disbursed),
        totalOutstanding:    parseFloat(stats.total_outstanding),
        totalMonthlyInterest: parseFloat(stats.total_monthly_interest),
        activeLoans:         parseInt(stats.active_loans, 10),
        repaidLoans:         parseInt(stats.repaid_loans, 10),
        defaultedLoans:      parseInt(stats.defaulted_loans, 10),
        repaymentRate: parseInt(stats.total_loans, 10) > 0
          ? ((parseInt(stats.repaid_loans, 10) / parseInt(stats.total_loans, 10)) * 100).toFixed(2)
          : 0
      },
      byType: byTypeResult.rows.map(r => ({
        loanType: r.loan_type, count: parseInt(r.count, 10),
        totalAmount: parseFloat(r.total_amount), totalOutstanding: parseFloat(r.total_outstanding)
      })),
      topBorrowers: topBorrowersResult.rows.map(r => ({
        memberId: r.member_id, fullName: r.full_name,
        loanCount: parseInt(r.loan_count, 10),
        totalBorrowed: parseFloat(r.total_borrowed), totalOutstanding: parseFloat(r.total_outstanding)
      }))
    };
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCycleReport,
  getMemberStatement,
  getComplianceReport,
  getSavingsGrowthReport,
  getLoanPortfolioReport
};
