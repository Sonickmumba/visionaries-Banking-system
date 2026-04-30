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
       COALESCE(SUM(savings_principal),    0) AS total_savings,
       COALESCE(SUM(cumulative_borrowing), 0) AS total_loans,
       COUNT(*) FILTER (WHERE social_fund_paid)    AS social_fund_paid_count,
       COUNT(*) FILTER (WHERE membership_fee_paid) AS membership_fee_paid_count
     FROM monthly_balances
     WHERE cycle_id = $1 AND month = $2`,
    [cycleId, month]
  );

  const { total_savings, total_loans, social_fund_paid_count, membership_fee_paid_count } = totalsResult.rows[0];
  const socialFundPerMember    = cycleConfig.socialFund || cycleConfig.socialFundAmount || 0;
  const membershipFeePerMember = cycleConfig.membershipFee    || 0;
  const totalSocialFund        = socialFundPerMember    * parseInt(social_fund_paid_count,    10);
  const totalMembershipFees    = membershipFeePerMember * parseInt(membership_fee_paid_count, 10);
  const totalPool              = parseFloat(total_savings) + totalSocialFund + totalMembershipFees;
  const unborrowedMoney        = totalPool - parseFloat(total_loans);
  const interestRate           = cycleConfig.interestRate || cycleConfig.commonInterestRate || 0.15;
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
    totalLoans: parseFloat(total_loans),           // cumulative_borrowing (principal only)
    totalSocialFund, totalMembershipFees, totalPool,
    unborrowedMoney, unborrowedInterest, allMembersMetMinimum, availableMethods,
    interestRate,
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
    interestRate: analysis.interestRate,
    unborrowedPrincipal: analysis.unborrowedMoney,
    summary: {
      totalAllocated: allocations.reduce((s, a) => s + a.charge, 0),
      memberCount: allocations.length
    }
  };
}

async function applyAllocations(cycleId, month, allocationMethod) {
  // Compute allocations before opening the transaction (read-only)
  const result = await calculateAllocations(cycleId, month, allocationMethod);
  const interestRate = result.interestRate;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const allocation of result.allocations) {
      // ── Guard: skip allocations already settled (paid) ───────────────────
      // Prevents re-applying from accidentally resetting paid allocations or
      // cancelling pool loans that haven't been repaid yet.
      const existingCia = await client.query(
        `SELECT status, pool_loan_id FROM common_interest_allocations
         WHERE member_id = $1 AND cycle_id = $2 AND month = $3`,
        [allocation.member_id, cycleId, month]
      );
      if (existingCia.rows[0]?.status === 'paid') continue;

      // ── Step 1: Upsert the common interest allocation record ─────────────
      // Only overwrite status when NOT already 'paid' (guard above ensures this)
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

      // ── Step 2: Set common_interest_due in monthly_balances ──────────────
      await client.query(
        `UPDATE monthly_balances
         SET common_interest_due = $1, updated_at = CURRENT_TIMESTAMP
         WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
        [allocation.charge, allocation.member_id, cycleId, month]
      );

      // ── Step 3: Record common interest assessment transaction ────────────
      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          allocation.member_id, cycleId, month,
          'common_interest_assessed', allocation.charge, new Date(),
          `Common interest allocated via ${allocationMethod}`
        ]
      );

      // ── Steps 4-8: Create pool loan for the unborrowed principal ─────────
      // principal = charge / interestRate (since charge = principal × interestRate)
      const principal = interestRate > 0
        ? parseFloat((allocation.charge / interestRate).toFixed(2))
        : 0;

      if (principal > 0) {
        // Check for an existing pool loan on this allocation (re-apply scenario)
        const existingPoolLoanId = existingCia.rows[0]?.pool_loan_id ?? null;

        if (existingPoolLoanId) {
          // Re-application: only cancel the old pool loan if it hasn't been
          // converted to 'common_interest' by enforcement yet.
          const oldLoanRow = await client.query(
            `SELECT amount, loan_type FROM loans WHERE id = $1`,
            [existingPoolLoanId]
          );
          const oldLoan = oldLoanRow.rows[0];
          if (oldLoan && oldLoan.loan_type === 'common_interest_pool') {
            const oldPrincipal = parseFloat(oldLoan.amount);

            await client.query(
              `UPDATE loans SET status = 'repaid', updated_at = CURRENT_TIMESTAMP
               WHERE id = $1 AND status = 'disbursed'`,
              [existingPoolLoanId]
            );

            await client.query(
              `UPDATE monthly_balances
               SET outstanding_loan     = GREATEST(0, outstanding_loan - $1),
                   cumulative_borrowing = GREATEST(0, cumulative_borrowing - $1),
                   updated_at           = CURRENT_TIMESTAMP
               WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
              [oldPrincipal, allocation.member_id, cycleId, month]
            );
          }
          // else: loan was already converted by enforcement — leave it alone
        }

        // Insert pool loan — monthly_interest=0 so it never compounds
        const loanResult = await client.query(
          `INSERT INTO loans (member_id, cycle_id, loan_type, amount, disbursed_date,
                              outstanding_balance, monthly_interest, status)
           VALUES ($1, $2, 'common_interest_pool', $3, CURRENT_DATE, $3, 0, 'disbursed')
           RETURNING id`,
          [allocation.member_id, cycleId, principal]
        );
        const poolLoanId = loanResult.rows[0].id;

        // Increase outstanding_loan and cumulative_borrowing for this member/month
        await client.query(
          `UPDATE monthly_balances
           SET outstanding_loan     = outstanding_loan + $1,
               cumulative_borrowing = cumulative_borrowing + $1,
               updated_at           = CURRENT_TIMESTAMP
           WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
          [principal, allocation.member_id, cycleId, month]
        );

        // Store principal and loan ID on the allocation row
        await client.query(
          `UPDATE common_interest_allocations
           SET principal_allocated = $1, pool_loan_id = $2, updated_at = CURRENT_TIMESTAMP
           WHERE member_id = $3 AND cycle_id = $4 AND month = $5`,
          [principal, poolLoanId, allocation.member_id, cycleId, month]
        );

        // Record the pool loan disbursement in transactions
        await client.query(
          `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
           VALUES ($1, $2, $3, 'common_interest_pool_loan', $4, $5, $6)`,
          [
            allocation.member_id, cycleId, month, principal, new Date(),
            `Unborrowed pool principal allocated (month ${month}) via ${allocationMethod}`
          ]
        );
      }
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

/**
 * Record a common-interest payment made by a member.
 *
 * Business rules enforced here:
 *   - Amount must not exceed common_interest_due for that month.
 *   - If payment_date > 3rd of the NEXT calendar month → K100 late-payment
 *     penalty is assessed and recorded in the penalties table.
 *   - On full payment: common_interest_due zeroed in monthly_balances;
 *     common_interest_allocations.status → 'paid'.
 *   - On partial payment: common_interest_due reduced; allocation stays
 *     'allocated' so admin can see the outstanding residual.
 *
 * @param {number} cycleId
 * @param {number} memberId
 * @param {number} month        - The month the charge belongs to (current_month at time of allocation)
 * @param {number} amount       - Amount the member is paying now
 * @param {string} paymentDate  - ISO date string e.g. '2026-05-02'
 */
async function payCommonInterest(cycleId, memberId, month, amount, paymentDate) {
  const client = await db.pool.connect();
  console.log(`Processing common interest payment: cycleId=${cycleId}, memberId=${memberId}, month=${month}, amount=${amount}, paymentDate=${paymentDate}`);
  try {
    await client.query('BEGIN');

    // ── Validate allocation exists and charge amount ─────────────────────
    // ── Find the oldest unpaid allocation for this member ────────────────
    // The allocation month (cia.month) differs from the display month when
    // common_interest_due has been carried forward across month boundaries.
    // We look up the allocation independently and use `month` (the caller's
    // current display month) only for monthly_balances updates.
    const allocResult = await client.query(
      `SELECT cia.id, cia.month AS allocation_month, cia.charge,
              mb.common_interest_due,
              c.start_date, c.config
       FROM common_interest_allocations cia
       JOIN monthly_balances mb ON mb.member_id = $1
                                AND mb.cycle_id  = $2
                                AND mb.month     = $3
       JOIN cycles c ON c.id = cia.cycle_id
       WHERE cia.member_id = $1 AND cia.cycle_id = $2 AND cia.status = 'allocated'
       ORDER BY cia.month ASC
       LIMIT 1`,
      [memberId, cycleId, month]
    );
    if (!allocResult.rows[0]) {
      throw new Error('No unpaid common interest allocation found for this member');
    }

    const { id: allocationId, allocation_month, charge, common_interest_due, start_date, config } = allocResult.rows[0];
    const due = parseFloat(common_interest_due);

    if (parseFloat(amount) <= 0) throw new Error('Payment amount must be greater than zero');
    if (parseFloat(amount) > due) throw new Error(`Payment amount (${amount}) exceeds amount due (${due})`);

    // ── Late-payment penalty check ────────────────────────────────────────
    // Payment window: 28th of allocation month through 3rd of the NEXT calendar month.
    // Deadline is computed from allocation_month (when the charge was raised),
    // not from the current display month.
    const cycleStart         = new Date(start_date);
    const allocationCalMonth = (cycleStart.getMonth() + allocation_month - 1) % 12; // 0-based
    const allocationYear     =
      cycleStart.getFullYear() +
      Math.floor((cycleStart.getMonth() + allocation_month - 1) / 12);
    const nextCalMonth  = (allocationCalMonth + 1) % 12;
    const nextCalYear   = allocationCalMonth === 11 ? allocationYear + 1 : allocationYear;
    const deadlineDate  = new Date(Date.UTC(nextCalYear, nextCalMonth, 3, 23, 59, 59));

    const paid   = new Date(paymentDate);
    const isLate = paid > deadlineDate;

    const latePenaltyAmount = config?.lateCommonInterestPenalty ?? 100;

    // ── Apply the payment ────────────────────────────────────────────────
    const newDue      = Math.max(0, due - parseFloat(amount));
    const isFullyPaid = newDue === 0;
    const allocStatus = isFullyPaid ? 'paid' : 'allocated';

    // Update the DISPLAY month's monthly_balances (that's what the member sees)
    await client.query(
      `UPDATE monthly_balances
       SET common_interest_due = $1, updated_at = CURRENT_TIMESTAMP
       WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
      [newDue, memberId, cycleId, month]
    );

    // Update the allocation record by its primary key (avoids month confusion)
    await client.query(
      `UPDATE common_interest_allocations
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [allocStatus, allocationId]
    );

    // Record transaction against the allocation month so the audit trail is correct
    await client.query(
      `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, $3, 'common_interest_payment', $4, $5, $6)`,
      [memberId, cycleId, allocation_month, amount, paymentDate,
       `Common interest payment (month ${allocation_month})${isLate ? ' — LATE' : ''}`]
    );

    let penaltyId = null;
    if (isLate) {
      const penResult = await client.query(
        `INSERT INTO penalties (member_id, cycle_id, month, penalty_type, amount, status, reason)
         VALUES ($1, $2, $3, 'late_common_interest', $4, 'assessed', $5)
         RETURNING id`,
        [memberId, cycleId, allocation_month, latePenaltyAmount,
         `Common interest paid late (after 3rd of month following month ${allocation_month}). Payment date: ${paymentDate}`]
      );
      penaltyId = penResult.rows[0].id;

      // Add penalty to DISPLAY month's balances so it shows immediately
      await client.query(
        `UPDATE monthly_balances
         SET penalties_due = penalties_due + $1, updated_at = CURRENT_TIMESTAMP
         WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
        [latePenaltyAmount, memberId, cycleId, month]
      );

      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'penalty_assessed', $4, $5, $6)`,
        [memberId, cycleId, allocation_month, latePenaltyAmount, paymentDate,
         `Late common interest penalty — paid after deadline for month ${allocation_month}`]
      );
    }

    await client.query('COMMIT');
    return {
      paid:          parseFloat(amount),
      remaining:     newDue,
      isFullyPaid,
      isLate,
      penaltyId,
      allocationMonth: allocation_month,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Enforce unpaid common interest for members who haven't paid by the deadline
 * (3rd of the calendar month following allocation).
 *
 * Called by admin after the payment window closes.
 *
 * Strategy: convert the pool loan IN-PLACE rather than creating a new combined
 * loan. This preserves loan.amount (used by the dashboard pool formula) and avoids
 * double-counting principal in total_disbursed_principal.
 *
 * For each member with common_interest_due > 0:
 *
 *   A. Member HAS an active pool loan (pool_loan_id set):
 *      1. UPDATE the pool loan: loan_type → 'common_interest',
 *         outstanding_balance += commonInterestDue, monthly_interest recalculated.
 *         loan.amount is NOT changed — pool formula stays correct.
 *      2. UPDATE monthly_balances: outstanding_loan += commonInterestDue (interest only,
 *         principal was already counted when pool loan was created), common_interest_due = 0.
 *      3. Clear pool_loan_id on the allocation (loan is no longer a pool loan).
 *
 *   B. Member has NO pool loan (pre-feature or member already repaid pool loan):
 *      1. INSERT a new 'common_interest' loan for commonInterestDue.
 *      2. UPDATE monthly_balances: outstanding_loan += commonInterestDue, common_interest_due = 0.
 *
 *   Both paths: mark CIA 'paid', record 'common_interest_converted_to_loan' transaction.
 *
 * Backward-compatible: allocations created before this feature (pool_loan_id = NULL)
 * follow path B and behave exactly as the original enforcement did.
 *
 * @param {number} cycleId
 * @param {number} month  - The display month to check (usually current_month)
 */
async function enforceUnpaidCommonInterest(cycleId, month) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch all members with outstanding common interest due this month.
    // The LATERAL join finds the oldest 'allocated' CIA row (and its pool_loan_id).
    // The LEFT JOIN fetches the pool loan's current outstanding_balance (if still active).
    const unpaidResult = await client.query(
      `SELECT mb.member_id,
              COALESCE(mb.common_interest_due, 0) AS common_interest_due,
              cia.id              AS allocation_id,
              cia.month           AS allocation_month,
              cia.pool_loan_id,
              l.outstanding_balance AS pool_loan_outstanding,
              c.current_month, c.config
       FROM monthly_balances mb
       JOIN cycles c ON c.id = mb.cycle_id
       LEFT JOIN LATERAL (
         SELECT id, month, pool_loan_id
         FROM common_interest_allocations
         WHERE member_id = mb.member_id AND cycle_id = mb.cycle_id AND status = 'allocated'
         ORDER BY month ASC LIMIT 1
       ) cia ON TRUE
       LEFT JOIN loans l
         ON l.id = cia.pool_loan_id AND l.status IN ('disbursed', 'approved')
       WHERE mb.cycle_id = $1 AND mb.month = $2
         AND mb.common_interest_due > 0`,
      [cycleId, month]
    );

    if (unpaidResult.rows.length === 0) {
      await client.query('COMMIT');
      return { converted: 0, members: [] };
    }

    const cycleConfig      = unpaidResult.rows[0].config;
    const currentMonth     = unpaidResult.rows[0].current_month;
    const loanInterestRate = cycleConfig.interestRate || 0.15;
    const converted        = [];

    for (const row of unpaidResult.rows) {
      const memberId          = row.member_id;
      const commonInterestDue = parseFloat(row.common_interest_due || 0);
      const poolLoanId        = row.pool_loan_id;
      const poolLoanOutstanding = row.pool_loan_outstanding
        ? parseFloat(row.pool_loan_outstanding)
        : 0;
      const allocationId    = row.allocation_id;
      const allocationMonth = row.allocation_month;

      if (commonInterestDue <= 0) continue;

      let loanId;

      if (poolLoanId && poolLoanOutstanding > 0) {
        // ── Path A: Convert the pool loan in-place ──────────────────────────────────
        // Add the unpaid interest to the pool loan's outstanding_balance and switch
        // its type to 'common_interest' so processMonthEnd starts compounding it.
        // CRITICAL: loan.amount is NOT updated — the pool formula sums loan.amount
        // for total_disbursed_principal, so leaving it unchanged prevents double-counting.
        const newOutstanding    = parseFloat((poolLoanOutstanding + commonInterestDue).toFixed(2));
        const newMonthlyInterest = parseFloat((newOutstanding * loanInterestRate).toFixed(2));

        await client.query(
          `UPDATE loans
           SET loan_type           = 'common_interest',
               outstanding_balance = $1,
               monthly_interest    = $2,
               updated_at          = CURRENT_TIMESTAMP
           WHERE id = $3 AND status IN ('disbursed', 'approved')`,
          [newOutstanding, newMonthlyInterest, poolLoanId]
        );
        loanId = poolLoanId;

        // Clear the pool_loan_id reference (loan is no longer a pool loan)
        if (allocationId) {
          await client.query(
            `UPDATE common_interest_allocations
             SET pool_loan_id = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [allocationId]
          );
        }

        // Only the INTEREST portion is newly added to outstanding_loan.
        // Pool principal was already counted when the pool loan was created.
        await client.query(
          `UPDATE monthly_balances
           SET outstanding_loan     = outstanding_loan + $1,
               cumulative_borrowing = cumulative_borrowing + $1,
               common_interest_due  = 0,
               updated_at           = CURRENT_TIMESTAMP
           WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
          [commonInterestDue, memberId, cycleId, month]
        );

      } else {
        // ── Path B: No pool loan (pre-feature or already repaid). Create new loan. ──
        const newMonthlyInterest = parseFloat((commonInterestDue * loanInterestRate).toFixed(2));
        const loanResult = await client.query(
          `INSERT INTO loans (member_id, cycle_id, loan_type, amount, disbursed_date,
                              outstanding_balance, monthly_interest, status)
           VALUES ($1, $2, 'common_interest', $3, CURRENT_DATE, $3, $4, 'disbursed')
           RETURNING id`,
          [memberId, cycleId, commonInterestDue, newMonthlyInterest]
        );
        loanId = loanResult.rows[0].id;

        await client.query(
          `UPDATE monthly_balances
           SET outstanding_loan     = outstanding_loan + $1,
               cumulative_borrowing = cumulative_borrowing + $1,
               common_interest_due  = 0,
               updated_at           = CURRENT_TIMESTAMP
           WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
          [commonInterestDue, memberId, cycleId, month]
        );
      }

      // ── Mark the allocation settled ─────────────────────────────────────────────────
      if (allocationId) {
        await client.query(
          `UPDATE common_interest_allocations
           SET status = 'paid', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [allocationId]
        );
      }

      // ── Audit transaction ───────────────────────────────────────────────────────────
      const description = poolLoanId
        ? `Pool loan (id:${loanId}) converted to common_interest — ` +
          `principal K${poolLoanOutstanding} + interest K${commonInterestDue} ` +
          `= K${(poolLoanOutstanding + commonInterestDue).toFixed(2)} (month ${allocationMonth ?? month})`
        : `Unpaid common interest (month ${allocationMonth ?? month}) ` +
          `K${commonInterestDue} converted to loan (id: ${loanId})`;

      await client.query(
        `INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
         VALUES ($1, $2, $3, 'common_interest_converted_to_loan', $4, CURRENT_DATE, $5)`,
        [memberId, cycleId, currentMonth, commonInterestDue, description]
      );

      converted.push({ memberId, commonInterestDue, poolLoanOutstanding: poolLoanId ? poolLoanOutstanding : 0, loanId, allocationMonth });
    }

    await client.query('COMMIT');
    return { converted: converted.length, members: converted };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  analyzeBorrowingPatterns,
  calculateAllocations,
  applyAllocations,
  getAllocations,
  payCommonInterest,
  enforceUnpaidCommonInterest,
};
