const db = require('../config/database');

// ─── Read-only helpers (use db.query — no dedicated connection needed) ───────

async function analyzeBorrowingPatterns(cycleId, month) {
  const cycleResult = await db.query(
    'SELECT config FROM cycles WHERE id = $1',
    [cycleId]
  );
  if (!cycleResult.rows[0]) throw new Error('Cycle not found');

  const cycleConfig = cycleResult.rows[0].config;
  const minimumBorrowingAmount = cycleConfig.minimumBorrowingAmount || 20000;

  const balancesResult = await db.query(
    `SELECT
       mb.*,
       m.user_id,
       u.full_name,
       COALESCE(mb.cumulative_borrowing, 0) AS cumulative_borrowing,
       COALESCE(mb.outstanding_loan, 0)     AS outstanding_loan,
       COALESCE(mb.savings_principal, 0)    AS savings_principal,
       COALESCE(mb.accumulated_savings, 0)  AS accumulated_savings
     FROM monthly_balances mb
     JOIN members m ON mb.member_id = m.id
     JOIN users  u ON m.user_id     = u.id
     WHERE mb.cycle_id = $1 AND mb.month = $2 AND m.status = 'active'
     ORDER BY u.full_name`,
    [cycleId, month]
  );

  const members = balancesResult.rows;
  const neverBorrowed = [];
  const borrowedBelowMinimum = [];
  const borrowedAtOrAboveMinimum = [];

  for (const member of members) {
    const cumBorrowing = parseFloat(member.cumulative_borrowing);
    if (cumBorrowing === 0) {
      neverBorrowed.push(member);
    } else if (cumBorrowing < minimumBorrowingAmount) {
      borrowedBelowMinimum.push({ ...member, shortfall: minimumBorrowingAmount - cumBorrowing });
    } else {
      borrowedAtOrAboveMinimum.push(member);
    }
  }

  const totalsResult = await db.query(
    `SELECT
       COALESCE(SUM(accumulated_savings), 0) AS total_savings,
       COALESCE(SUM(outstanding_loan), 0)    AS total_loans
     FROM monthly_balances
     WHERE cycle_id = $1 AND month = $2`,
    [cycleId, month]
  );

  const { total_savings, total_loans } = totalsResult.rows[0];
  const socialFundPerMember    = cycleConfig.socialFundAmount || 0;
  const membershipFeePerMember = cycleConfig.membershipFee    || 0;
  const totalSocialFund        = socialFundPerMember    * members.length;
  const totalMembershipFees    = membershipFeePerMember * members.length;
  const totalPool              = parseFloat(total_savings) + totalSocialFund + totalMembershipFees;
  const unborrowedMoney        = totalPool - parseFloat(total_loans);
  const interestRate           = cycleConfig.interestRate || 0.15;
  const unborrowedInterest     = unborrowedMoney * interestRate;
  const allMembersMetMinimum   = borrowedAtOrAboveMinimum.length === members.length;

  const availableMethods = [];
  if (neverBorrowed.length > 0) availableMethods.push('never_borrowed_only');
  if (neverBorrowed.length > 0 || borrowedBelowMinimum.length > 0) availableMethods.push('never_borrowed_and_below_minimum');
  if (allMembersMetMinimum && unborrowedMoney > 0) availableMethods.push('all_members');

  return {
    cycleId, month, minimumBorrowingAmount,
    totalMembers: members.length,
    neverBorrowedCount: neverBorrowed.length,
    borrowedBelowMinimumCount: borrowedBelowMinimum.length,
    borrowedAtOrAboveMinimumCount: borrowedAtOrAboveMinimum.length,
    totalSavings: parseFloat(total_savings),
    totalLoans: parseFloat(total_loans),
    totalSocialFund, totalMembershipFees, totalPool,
    unborrowedMoney, unborrowedInterest, allMembersMetMinimum, availableMethods,
    memberDetails: { neverBorrowed, borrowedBelowMinimum, borrowedAtOrAboveMinimum }
  };
}

async function calculateAllocations(cycleId, month, allocationMethod) {
  const analysis = await analyzeBorrowingPatterns(cycleId, month);

  if (!analysis.availableMethods.includes(allocationMethod)) {
    throw new Error(`Allocation method '${allocationMethod}' is not available for this cycle and month`);
  }

  const allocations = [];
  const commonInterestAmount = analysis.unborrowedInterest;

  if (allocationMethod === 'never_borrowed_only') {
    const eligible = analysis.memberDetails.neverBorrowed;
    const perMember = eligible.length > 0 ? commonInterestAmount / eligible.length : 0;
    for (const member of eligible) {
      allocations.push({
        member_id: member.member_id,
        member_name: member.full_name,
        eligibility_status: 'never_borrowed',
        shortfall: 0, assigned_base: 0,
        charge: parseFloat(perMember.toFixed(2)),
        allocation_method: 'equal_split'
      });
    }

  } else if (allocationMethod === 'never_borrowed_and_below_minimum') {
    const { neverBorrowed, borrowedBelowMinimum } = analysis.memberDetails;
    const totalShortfall =
      neverBorrowed.length * analysis.minimumBorrowingAmount +
      borrowedBelowMinimum.reduce((s, m) => s + m.shortfall, 0);

    for (const member of neverBorrowed) {
      const proportion = analysis.minimumBorrowingAmount / totalShortfall;
      allocations.push({
        member_id: member.member_id, member_name: member.full_name,
        eligibility_status: 'never_borrowed',
        shortfall: analysis.minimumBorrowingAmount,
        assigned_base: analysis.minimumBorrowingAmount,
        charge: parseFloat((commonInterestAmount * proportion).toFixed(2)),
        allocation_method: 'proportional_to_shortfall'
      });
    }
    for (const member of borrowedBelowMinimum) {
      const proportion = member.shortfall / totalShortfall;
      allocations.push({
        member_id: member.member_id, member_name: member.full_name,
        eligibility_status: 'borrowed_below_minimum',
        shortfall: member.shortfall, assigned_base: member.shortfall,
        charge: parseFloat((commonInterestAmount * proportion).toFixed(2)),
        allocation_method: 'proportional_to_shortfall'
      });
    }

  } else if (allocationMethod === 'all_members') {
    const all = [
      ...analysis.memberDetails.neverBorrowed,
      ...analysis.memberDetails.borrowedBelowMinimum,
      ...analysis.memberDetails.borrowedAtOrAboveMinimum
    ];
    const perMember = all.length > 0 ? commonInterestAmount / all.length : 0;
    for (const member of all) {
      const cb = parseFloat(member.cumulative_borrowing || 0);
      let eligibilityStatus = 'at_or_above_minimum';
      if (cb === 0) eligibilityStatus = 'never_borrowed';
      else if (cb < analysis.minimumBorrowingAmount) eligibilityStatus = 'borrowed_below_minimum';
      allocations.push({
        member_id: member.member_id, member_name: member.full_name,
        eligibility_status: eligibilityStatus,
        shortfall: 0, assigned_base: 0,
        charge: parseFloat(perMember.toFixed(2)),
        allocation_method: 'equal_split_all_members'
      });
    }
  }

  return {
    cycleId, month, allocationMethod, commonInterestAmount, allocations,
    summary: {
      totalAllocated: allocations.reduce((s, a) => s + a.charge, 0),
      memberCount: allocations.length
    }
  };
}

async function applyAllocations(cycleId, month, allocationMethod) {
  // Compute allocations before opening the transaction (read-only)
  const result = await calculateAllocations(cycleId, month, allocationMethod);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const allocation of result.allocations) {
      await client.query(
        `INSERT INTO common_interest_allocations (
           member_id, cycle_id, month, eligibility_status, shortfall,
           assigned_base, charge, allocation_method, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (member_id, cycle_id, month) DO UPDATE SET
           eligibility_status = EXCLUDED.eligibility_status,
           shortfall          = EXCLUDED.shortfall,
           assigned_base      = EXCLUDED.assigned_base,
           charge             = EXCLUDED.charge,
           allocation_method  = EXCLUDED.allocation_method,
           status             = EXCLUDED.status,
           updated_at         = CURRENT_TIMESTAMP`,
        [
          allocation.member_id, cycleId, month,
          allocation.eligibility_status, allocation.shortfall,
          allocation.assigned_base, allocation.charge,
          allocation.allocation_method, 'allocated'
        ]
      );

      await client.query(
        `UPDATE monthly_balances
         SET common_interest_due = $1, updated_at = CURRENT_TIMESTAMP
         WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
        [allocation.charge, allocation.member_id, cycleId, month]
      );

      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          allocation.member_id, cycleId, month,
          'common_interest_assessed', allocation.charge, new Date(),
          `Common interest allocated via ${allocationMethod}`
        ]
      );
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAllocations(cycleId, month) {
  const result = await db.query(
    `SELECT
       cia.*,
       u.full_name AS member_name
     FROM common_interest_allocations cia
     JOIN members m ON cia.member_id = m.id
     JOIN users   u ON m.user_id     = u.id
     WHERE cia.cycle_id = $1 AND cia.month = $2
     ORDER BY u.full_name`,
    [cycleId, month]
  );
  return result.rows;
}

module.exports = {
  analyzeBorrowingPatterns,
  calculateAllocations,
  applyAllocations,
  getAllocations
};
