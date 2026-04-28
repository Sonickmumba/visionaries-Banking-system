const db = require('../config/database');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Batch-fetch declaration details for a set of entity IDs.
 * Returns a Map keyed by entity_id.
 */
async function fetchDeclarationDetails(entityIds) {
  if (!entityIds.length) return new Map();
  const result = await db.query(
    `SELECT d.*, uf.id AS file_id, uf.file_name, uf.file_type
     FROM declarations d
     LEFT JOIN uploaded_files uf ON d.payment_proof_id = uf.id
     WHERE d.id = ANY($1)`,
    [entityIds]
  );
  return new Map(result.rows.map((r) => [r.id, r]));
}

/**
 * Batch-fetch loan-repayment details for a set of entity IDs.
 * Returns a Map keyed by entity_id.
 */
async function fetchRepaymentDetails(entityIds) {
  if (!entityIds.length) return new Map();
  const result = await db.query(
    `SELECT lr.*, l.loan_type, l.amount AS loan_amount,
            uf.id AS file_id, uf.file_name, uf.file_type
     FROM loan_repayments lr
     INNER JOIN loans l ON lr.loan_id = l.id
     LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
     WHERE lr.id = ANY($1)`,
    [entityIds]
  );
  return new Map(result.rows.map((r) => [r.id, r]));
}

// ─── public functions ────────────────────────────────────────────────────────

/**
 * Create an approval record (uses the shared db connection).
 */
async function createApproval(approvalType, entityId, memberId, cycleId, amount, submittedBy) {
  const result = await db.query(
    `INSERT INTO approvals
       (approval_type, entity_id, member_id, cycle_id, amount, submitted_by, submitted_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'pending')
     RETURNING *`,
    [approvalType, entityId, memberId, cycleId, amount, submittedBy]
  );
  return result.rows[0];
}

/**
 * Create an approval record inside an existing transaction client.
 * Used by declarationsModel to batch all approvals in one transaction.
 */
async function createApprovalWithClient(client, approvalType, entityId, memberId, cycleId, amount, submittedBy) {
  const result = await client.query(
    `INSERT INTO approvals
       (approval_type, entity_id, member_id, cycle_id, amount, submitted_by, submitted_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'pending')
     RETURNING *`,
    [approvalType, entityId, memberId, cycleId, amount, submittedBy]
  );
  return result.rows[0];
}

/**
 * Recompute and update a declaration's status from its associated approval records.
 * Called inside a transaction after each approve/reject action.
 * Rules:
 *   - any rejected  → declaration = 'rejected'
 *   - all approved  → declaration = 'approved'
 *   - some pending  → declaration = 'pending'
 */
async function syncDeclarationStatus(client, declarationId, reviewerId) {
  const result = await client.query(
    `SELECT status FROM approvals
     WHERE entity_id = $1 AND approval_type IN ('savings_declaration', 'loan_request')`,
    [declarationId]
  );
  const statuses = result.rows.map((r) => r.status);
  if (!statuses.length) return;

  let newStatus;
  if (statuses.some((s) => s === 'rejected')) {
    newStatus = 'rejected';
  } else if (statuses.every((s) => s === 'approved')) {
    newStatus = 'approved';
  } else {
    newStatus = 'pending'; // still has pending items
  }

  await client.query(
    `UPDATE declarations
     SET status = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [newStatus, reviewerId, declarationId]
  );
}

/**
 * Get all approvals with optional filters.
 * Uses batch queries per approval_type to avoid N+1.
 */
async function getApprovals(filters = {}) {
  const { cycleId, type, status = 'pending', limit = 50, offset = 0 } = filters;

  let query = `
    SELECT
      a.*,
      m.id   AS member_id,
      u.full_name AS member_name,
      u.email     AS member_email,
      u.phone     AS member_phone,
      submitter.full_name AS submitted_by_name,
      reviewer.full_name  AS reviewed_by_name,
      c.name AS cycle_name
    FROM approvals a
    INNER JOIN members m ON a.member_id = m.id
    INNER JOIN users   u ON m.user_id   = u.id
    LEFT  JOIN users submitter ON a.submitted_by = submitter.id
    LEFT  JOIN users reviewer  ON a.reviewed_by  = reviewer.id
    LEFT  JOIN cycles c        ON a.cycle_id     = c.id
    WHERE 1=1
  `;

  const params = [];
  let i = 1;

  if (cycleId) {
    query += ` AND a.cycle_id = $${i++}`;
    params.push(cycleId);
  }
  if (type && type !== 'all') {
    query += ` AND a.approval_type = $${i++}`;
    params.push(type);
  }
  if (status && status !== 'all') {
    query += ` AND a.status = $${i++}`;
    params.push(status);
  }

  query += ` ORDER BY a.submitted_at DESC LIMIT $${i} OFFSET $${i + 1}`;
  params.push(limit, offset);

  const result = await db.query(query, params);
  const rows = result.rows;

  // Batch-fetch details by type (avoids N+1)
  // savings_declaration and loan_request both point to declarations.id
  const declIds = rows
    .filter((r) => r.approval_type === 'savings_declaration' || r.approval_type === 'loan_request')
    .map((r) => r.entity_id);
  const repayIds = rows
    .filter((r) => r.approval_type === 'loan_repayment')
    .map((r) => r.entity_id);

  const [declMap, repayMap] = await Promise.all([
    fetchDeclarationDetails(declIds),
    fetchRepaymentDetails(repayIds),
  ]);

  return rows.map((row) => {
    let details = {};
    if (row.approval_type === 'savings_declaration' || row.approval_type === 'loan_request') {
      details = declMap.get(row.entity_id) || {};
    } else if (row.approval_type === 'loan_repayment') {
      details = repayMap.get(row.entity_id) || {};
    }
    return { ...row, details };
  });
}

/**
 * Get a single approval by ID with full details.
 */
async function getApprovalById(approvalId) {
  const result = await db.query(
    `SELECT
       a.*,
       m.id   AS member_id,
       u.full_name AS member_name,
       u.email     AS member_email,
       u.phone     AS member_phone,
       submitter.full_name AS submitted_by_name,
       reviewer.full_name  AS reviewed_by_name,
       c.name AS cycle_name
     FROM approvals a
     INNER JOIN members m ON a.member_id = m.id
     INNER JOIN users   u ON m.user_id   = u.id
     LEFT  JOIN users submitter ON a.submitted_by = submitter.id
     LEFT  JOIN users reviewer  ON a.reviewed_by  = reviewer.id
     LEFT  JOIN cycles c        ON a.cycle_id     = c.id
     WHERE a.id = $1`,
    [approvalId]
  );

  if (!result.rows[0]) return null;

  const approval = result.rows[0];
  let details = {};

  if (approval.approval_type === 'savings_declaration') {
    const declResult = await db.query(
      `SELECT d.*, uf.id AS file_id, uf.file_name, uf.file_type, uf.file_path
       FROM declarations d
       LEFT JOIN uploaded_files uf ON d.payment_proof_id = uf.id
       WHERE d.id = $1`,
      [approval.entity_id]
    );
    details = declResult.rows[0] || {};
  } else if (approval.approval_type === 'loan_request') {
    const declResult = await db.query(
      `SELECT d.*, uf.id AS file_id, uf.file_name, uf.file_type, uf.file_path
       FROM declarations d
       LEFT JOIN uploaded_files uf ON d.payment_proof_id = uf.id
       WHERE d.id = $1`,
      [approval.entity_id]
    );
    details = declResult.rows[0] || {};
  } else if (approval.approval_type === 'loan_repayment') {
    const repayResult = await db.query(
      `SELECT lr.*, l.loan_type, l.amount AS loan_amount,
              uf.id AS file_id, uf.file_name, uf.file_type, uf.file_path
       FROM loan_repayments lr
       INNER JOIN loans l ON lr.loan_id = l.id
       LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
       WHERE lr.id = $1`,
      [approval.entity_id]
    );
    details = repayResult.rows[0] || {};
  }

  return { ...approval, details };
}

/**
 * Get approval counts/amounts grouped by type and status for a given cycle.
 */
async function getApprovalStats(cycleId) {
  const result = await db.query(
    `SELECT
       approval_type,
       status,
       COUNT(*)                 AS count,
       COALESCE(SUM(amount), 0) AS total_amount
     FROM approvals
     WHERE cycle_id = $1
     GROUP BY approval_type, status`,
    [cycleId]
  );

  const stats = {
    pending_savings: 0,
    pending_loan_requests: 0,
    pending_repayments: 0,
    total_pending: 0,
    approved_savings: 0,
    approved_loan_requests: 0,
    approved_repayments: 0,
    rejected_savings: 0,
    rejected_loan_requests: 0,
    rejected_repayments: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    if (row.approval_type === 'savings_declaration') {
      if (row.status === 'pending')  stats.pending_savings  = count;
      else if (row.status === 'approved') stats.approved_savings = count;
      else if (row.status === 'rejected') stats.rejected_savings = count;
    } else if (row.approval_type === 'loan_request') {
      if (row.status === 'pending')  stats.pending_loan_requests  = count;
      else if (row.status === 'approved') stats.approved_loan_requests = count;
      else if (row.status === 'rejected') stats.rejected_loan_requests = count;
    } else if (row.approval_type === 'loan_repayment') {
      if (row.status === 'pending')  stats.pending_repayments  = count;
      else if (row.status === 'approved') stats.approved_repayments = count;
      else if (row.status === 'rejected') stats.rejected_repayments = count;
    }
  }

  stats.total_pending = stats.pending_savings + stats.pending_loan_requests + stats.pending_repayments;
  return stats;
}

/**
 * Approve a savings declaration (transactional).
 * Marks the declaration and approval approved, then commits the savings
 * into the savings table and updates monthly_balances.
 */
async function approveSavingsDeclaration(approvalId, reviewerId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'savings_declaration']
    );

    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    // Fetch the full declaration
    const declResult = await client.query(
      'SELECT * FROM declarations WHERE id = $1',
      [approval.entity_id]
    );
    if (!declResult.rows[0]) throw new Error('Declaration not found');
    const decl = declResult.rows[0];

    // Commit savings into savings table (if not already recorded)
    if (parseFloat(decl.savings_amount) > 0) {
      const cycleResult = await client.query(
        'SELECT current_month, config FROM cycles WHERE id = $1',
        [decl.cycle_id]
      );
      const config     = cycleResult.rows[0]?.config ?? {};
      const maxSavings = config.maxSavings || 30000;

      // Check cap
      const cycleTotalResult = await client.query(
        'SELECT COALESCE(SUM(total_principal), 0) AS cycle_total FROM savings WHERE member_id = $1 AND cycle_id = $2',
        [decl.member_id, decl.cycle_id]
      );
      const existingTotal = parseFloat(cycleTotalResult.rows[0].cycle_total);
      const newPrincipal  = parseFloat(decl.savings_amount);

      if (existingTotal + newPrincipal > maxSavings) {
        throw new Error(`Deposit would exceed cycle savings cap of K${maxSavings.toLocaleString()}`);
      }

      // Check not already committed (idempotency guard)
      const existingSavings = await client.query(
        'SELECT id FROM savings WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
        [decl.member_id, decl.cycle_id, decl.month]
      );

      if (!existingSavings.rows[0]) {
        const memberNameResult = await client.query(
          'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
          [decl.member_id]
        );
        const memberName = memberNameResult.rows[0]?.full_name || '';

        await client.query(
          `INSERT INTO savings
             (member_id, cycle_id, month, principal_deposit, total_principal, savings_interest, accumulated_savings)
           VALUES ($1, $2, $3, $4, $5, 0, $6)`,
          [decl.member_id, decl.cycle_id, decl.month, newPrincipal, newPrincipal, newPrincipal]
        );

        await client.query(
          `UPDATE monthly_balances
           SET savings_principal   = savings_principal   + $1,
               accumulated_savings = accumulated_savings + $1
           WHERE member_id = $2 AND cycle_id = $3 AND month = $4`,
          [newPrincipal, decl.member_id, decl.cycle_id, decl.month]
        );

        await client.query(
          `INSERT INTO transactions
             (member_id, cycle_id, month, type, amount, date, description)
           VALUES ($1, $2, $3, 'savings_deposit', $4, NOW(), $5)`,
          [decl.member_id, decl.cycle_id, decl.month, newPrincipal,
           `Savings deposit approved for ${memberName} (declaration #${decl.id})`]
        );
      }
    }

    await client.query(
      `UPDATE approvals
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, approvalId]
    );

    // Recompute declaration status from all its approval records
    await syncDeclarationStatus(client, approval.entity_id, reviewerId);

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject a savings declaration (transactional).
 */
async function rejectSavingsDeclaration(approvalId, reviewerId, reason) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'savings_declaration']
    );

    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    await client.query(
      `UPDATE approvals
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), notes = $2
       WHERE id = $3`,
      [reviewerId, reason, approvalId]
    );

    // Also mark declaration rejected immediately (any rejection stops the process)
    await client.query(
      `UPDATE declarations
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      [reviewerId, reason, approval.entity_id]
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approve a loan request (transactional).
 * Creates the actual loan record and updates monthly_balances.
 */
async function approveLoanRequest(approvalId, reviewerId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'loan_request']
    );
    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    const declResult = await client.query(
      'SELECT * FROM declarations WHERE id = $1',
      [approval.entity_id]
    );
    if (!declResult.rows[0]) throw new Error('Declaration not found');

    const decl        = declResult.rows[0];
    const loanAmount  = parseFloat(decl.loan_request);

    if (loanAmount <= 0) throw new Error('Loan request amount is zero');

    // Fetch cycle config for interest rate and current month
    const cycleResult = await client.query(
      'SELECT current_month, config FROM cycles WHERE id = $1',
      [decl.cycle_id]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');
    const currentMonth    = cycleResult.rows[0].current_month;
    const loanInterestRate = cycleResult.rows[0].config.loanInterestRate || 0.15;
    const monthlyInterest  = loanAmount * loanInterestRate;

    // Determine loan type: 'original' if no active loans, otherwise 'top_up'
    const existingLoanResult = await client.query(
      `SELECT COUNT(*) AS cnt FROM loans
       WHERE member_id = $1 AND cycle_id = $2 AND status IN ('disbursed','approved')`,
      [decl.member_id, decl.cycle_id]
    );
    const loanType = parseInt(existingLoanResult.rows[0].cnt, 10) > 0 ? 'top_up' : 'original';

    // Create loan record with correct monthly_interest
    await client.query(
      `INSERT INTO loans
         (member_id, cycle_id, loan_type, amount, disbursed_date, outstanding_balance,
          monthly_interest, status)
       VALUES ($1, $2, $3, $4, NOW(), $4, $5, 'disbursed')`,
      [decl.member_id, decl.cycle_id, loanType, loanAmount, monthlyInterest]
    );

    // Compute new cumulative_borrowing from current month's row
    const balResult = await client.query(
      'SELECT cumulative_borrowing FROM monthly_balances WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
      [decl.member_id, decl.cycle_id, currentMonth]
    );
    const newCumulative = parseFloat(balResult.rows[0]?.cumulative_borrowing || 0) + loanAmount;
    let complianceStatus = 'never_borrowed';
    if (newCumulative >= 20000) complianceStatus = 'at_or_above_minimum';
    else if (newCumulative > 0)  complianceStatus = 'borrowed_below_minimum';

    // Update monthly_balances for current month AND all future months already seeded
    await client.query(
      `UPDATE monthly_balances
       SET outstanding_loan    = outstanding_loan    + $1,
           cumulative_borrowing = $2,
           compliance_status    = $3
       WHERE member_id = $4 AND cycle_id = $5 AND month >= $6`,
      [loanAmount, newCumulative, complianceStatus, decl.member_id, decl.cycle_id, currentMonth]
    );

    // Transaction record
    const memberNameResult = await client.query(
      'SELECT u.full_name FROM members m JOIN users u ON m.user_id = u.id WHERE m.id = $1',
      [decl.member_id]
    );
    const memberName = memberNameResult.rows[0]?.full_name || '';

    await client.query(
      `INSERT INTO transactions
         (member_id, cycle_id, month, type, amount, date, description)
       VALUES ($1, $2, $3, 'loan_disbursement', $4, NOW(), $5)`,
      [decl.member_id, decl.cycle_id, decl.month, loanAmount,
       `Loan disbursement approved for ${memberName} (declaration #${decl.id})`]
    );

    // Mark this approval approved
    await client.query(
      `UPDATE approvals
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, approvalId]
    );

    // Recompute declaration status
    await syncDeclarationStatus(client, approval.entity_id, reviewerId);

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject a loan request (transactional).
 */
async function rejectLoanRequest(approvalId, reviewerId, reason) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'loan_request']
    );
    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    await client.query(
      `UPDATE approvals
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), notes = $2
       WHERE id = $3`,
      [reviewerId, reason, approvalId]
    );

    // Immediately mark the declaration as rejected
    await client.query(
      `UPDATE declarations
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      [reviewerId, reason, approval.entity_id]
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approve a loan repayment (transactional).
 * Updates repayment status, reduces outstanding balance, marks loan repaid if balance <= 0.
 */
async function approveLoanRepayment(approvalId, reviewerId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'loan_repayment']
    );

    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    const repaymentResult = await client.query(
      'SELECT * FROM loan_repayments WHERE id = $1',
      [approval.entity_id]
    );

    if (!repaymentResult.rows[0]) throw new Error('Loan repayment record not found');

    const repayment = repaymentResult.rows[0];

    await client.query(
      `UPDATE loan_repayments
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, approval.entity_id]
    );

    // Fetch cycle current_month so we update current + future balance rows
    const cycleMonthRes = await client.query(
      'SELECT current_month FROM cycles WHERE id = $1',
      [repayment.cycle_id]
    );
    const currentMonth = cycleMonthRes.rows[0]?.current_month;

    await client.query(
      `UPDATE loans
       SET outstanding_balance = outstanding_balance - $1, updated_at = NOW()
       WHERE id = $2`,
      [repayment.amount, repayment.loan_id]
    );

    const loanResult = await client.query(
      'SELECT outstanding_balance FROM loans WHERE id = $1',
      [repayment.loan_id]
    );

    const newOutstanding = parseFloat(loanResult.rows[0]?.outstanding_balance || 0);
    if (newOutstanding <= 0) {
      await client.query(
        `UPDATE loans SET status = 'repaid', updated_at = NOW() WHERE id = $1`,
        [repayment.loan_id]
      );
    }

    // Keep monthly_balances in sync — decrement current month and all future seeded rows
    if (currentMonth) {
      await client.query(
        `UPDATE monthly_balances
         SET outstanding_loan = GREATEST(outstanding_loan - $1, 0)
         WHERE member_id = $2 AND cycle_id = $3 AND month >= $4`,
        [repayment.amount, repayment.member_id, repayment.cycle_id, currentMonth]
      );
    }

    await client.query(
      `UPDATE approvals
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, approvalId]
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject a loan repayment (transactional).
 */
async function rejectLoanRepayment(approvalId, reviewerId, reason) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const approvalResult = await client.query(
      'SELECT * FROM approvals WHERE id = $1 AND approval_type = $2 FOR UPDATE',
      [approvalId, 'loan_repayment']
    );

    if (!approvalResult.rows[0]) throw new Error('Approval not found');

    const approval = approvalResult.rows[0];
    if (approval.status !== 'pending') throw new Error('Approval already processed');

    await client.query(
      `UPDATE loan_repayments
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      [reviewerId, reason, approval.entity_id]
    );

    await client.query(
      `UPDATE approvals
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), notes = $2
       WHERE id = $3`,
      [reviewerId, reason, approvalId]
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createApproval,
  createApprovalWithClient,
  getApprovals,
  getApprovalById,
  getApprovalStats,
  approveSavingsDeclaration,
  rejectSavingsDeclaration,
  approveLoanRequest,
  rejectLoanRequest,
  approveLoanRepayment,
  rejectLoanRepayment,
};
