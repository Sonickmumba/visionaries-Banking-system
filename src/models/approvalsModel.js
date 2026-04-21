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
 * Create an approval record.
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
  const declIds = rows
    .filter((r) => r.approval_type === 'savings_declaration')
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
    if (row.approval_type === 'savings_declaration') {
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
    pending_repayments: 0,
    total_pending: 0,
    approved_savings: 0,
    approved_repayments: 0,
    rejected_savings: 0,
    rejected_repayments: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    if (row.approval_type === 'savings_declaration') {
      if (row.status === 'pending') stats.pending_savings = count;
      else if (row.status === 'approved') stats.approved_savings = count;
      else if (row.status === 'rejected') stats.rejected_savings = count;
    } else if (row.approval_type === 'loan_repayment') {
      if (row.status === 'pending') stats.pending_repayments = count;
      else if (row.status === 'approved') stats.approved_repayments = count;
      else if (row.status === 'rejected') stats.rejected_repayments = count;
    }
  }

  stats.total_pending = stats.pending_savings + stats.pending_repayments;
  return stats;
}

/**
 * Approve a savings declaration (transactional).
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

    await client.query(
      `UPDATE declarations
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, approval.entity_id]
    );

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
      `UPDATE declarations
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

    if (loanResult.rows[0] && loanResult.rows[0].outstanding_balance <= 0) {
      await client.query(
        `UPDATE loans SET status = 'repaid', updated_at = NOW() WHERE id = $1`,
        [repayment.loan_id]
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
  getApprovals,
  getApprovalById,
  getApprovalStats,
  approveSavingsDeclaration,
  rejectSavingsDeclaration,
  approveLoanRepayment,
  rejectLoanRepayment,
};
