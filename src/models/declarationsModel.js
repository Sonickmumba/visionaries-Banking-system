const db = require('../config/database');
const approvalsModel = require('./approvalsModel');

function validateDeclarationWindow(currentDate, config) {
  const day = currentDate.getDate();
  const windowStart = config.declarationWindowStart || 28;
  const windowEnd   = config.declarationWindowEnd   || 3;
  if (windowStart > windowEnd) {
    return day >= windowStart || day <= windowEnd;
  }
  return day >= windowStart && day <= windowEnd;
}

async function getDeclarationsByCycle(cycleId, month) {
  const result = await db.query(
    `SELECT
       d.id, d.member_id, d.cycle_id, d.month, d.submitted_at,
       d.savings_amount, d.loan_request, d.principal_repayment,
       d.interest_repayment, d.status, d.payment_proof_id,
       d.reviewed_by, d.reviewed_at, d.rejection_reason,
       u.full_name        AS member_name,
       uf.file_name, uf.file_type,
       reviewer.full_name AS reviewed_by_name
     FROM declarations d
     JOIN members m ON d.member_id = m.id
     JOIN users   u ON m.user_id   = u.id
     LEFT JOIN uploaded_files uf ON d.payment_proof_id = uf.id
     LEFT JOIN users reviewer   ON d.reviewed_by       = reviewer.id
     WHERE d.cycle_id = $1 AND d.month = $2
     ORDER BY d.submitted_at DESC`,
    [cycleId, month]
  );
  return result.rows;
}

async function getDeclarationById(declarationId) {
  const result = await db.query(
    `SELECT
       d.*,
       u.full_name AS member_name, u.email AS member_email, u.phone AS member_phone,
       uf.id AS file_id, uf.file_name, uf.file_type, uf.file_path,
       reviewer.full_name AS reviewed_by_name
     FROM declarations d
     JOIN members m ON d.member_id = m.id
     JOIN users   u ON m.user_id   = u.id
     LEFT JOIN uploaded_files uf ON d.payment_proof_id = uf.id
     LEFT JOIN users reviewer   ON d.reviewed_by       = reviewer.id
     WHERE d.id = $1`,
    [declarationId]
  );
  if (!result.rows[0]) throw new Error('Declaration not found');
  return result.rows[0];
}

async function getMemberDeclaration(memberId, cycleId, month) {
  const result = await db.query(
    'SELECT * FROM declarations WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
    [memberId, cycleId, month]
  );
  return result.rows[0] || null;
}

async function submitDeclaration(declarationData) {
  const {
    member_id,
    cycle_id,
    savings_amount       = 0,
    loan_request         = 0,
    principal_repayment  = 0,
    interest_repayment   = 0,
    payment_proof_id     = null,
    loan_id              = null,   // required when principal_repayment > 0
    payment_method       = 'cash', // for loan repayment: 'cash' | 'mobile_money' | 'bank_transfer'
    user_id
  } = declarationData;

  const savingsAmt    = parseFloat(savings_amount)      || 0;
  const loanReqAmt    = parseFloat(loan_request)        || 0;
  const principalAmt  = parseFloat(principal_repayment) || 0;
  const interestAmt   = parseFloat(interest_repayment)  || 0;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const cycleResult = await client.query(
      'SELECT current_month, config FROM cycles WHERE id = $1',
      [cycle_id]
    );
    if (!cycleResult.rows[0]) throw new Error('Cycle not found');

    const currentMonth = cycleResult.rows[0].current_month;
    const config       = cycleResult.rows[0].config;

    // Window check applies only to savings deposits and loan repayments.
    // Loan requests are allowed at any time during the cycle.
    const hasWindowBoundItems = savingsAmt > 0 || (principalAmt + interestAmt) > 0;
    if (hasWindowBoundItems && !validateDeclarationWindow(new Date(), config)) {
      console.warn(`Savings/repayment submitted outside declaration window by member ${member_id}`);
    }

    // ── Per-type uniqueness rules ────────────────────────────────────────
    // Rule 1: savings — once per member per month
    if (savingsAmt > 0) {
      const savingsCheck = await client.query(
        `SELECT id FROM declarations
         WHERE member_id = $1 AND cycle_id = $2 AND month = $3 AND savings_amount > 0`,
        [member_id, cycle_id, currentMonth]
      );
      if (savingsCheck.rows[0]) {
        throw new Error('Savings already submitted for this month');
      }
    }

    // Rule 2: loan request — only one open (pending or approved) request per cycle
    if (loanReqAmt > 0) {
      const loanReqCheck = await client.query(
        `SELECT id FROM declarations
         WHERE member_id = $1 AND cycle_id = $2
           AND loan_request > 0
           AND status IN ('pending', 'approved')`,
        [member_id, cycle_id]
      );
      if (loanReqCheck.rows[0]) {
        throw new Error('A loan request is already pending or approved for this cycle');
      }
    }

    // Any non-zero item requires approval
    const needsApproval =
      savingsAmt > 0 || loanReqAmt > 0 || (principalAmt + interestAmt) > 0;
    const status = needsApproval ? 'pending' : 'submitted';

    const declarationResult = await client.query(
      `INSERT INTO declarations (
         member_id, cycle_id, month, submitted_at,
         savings_amount, loan_request, principal_repayment, interest_repayment,
         payment_proof_id, status
       ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9)
       RETURNING id, member_id, cycle_id, month, submitted_at, savings_amount,
                 loan_request, principal_repayment, interest_repayment, payment_proof_id, status`,
      [member_id, cycle_id, currentMonth, savingsAmt, loanReqAmt,
       principalAmt, interestAmt, payment_proof_id, status]
    );

    const declaration = declarationResult.rows[0];

    // ── 1. Savings deposit approval ──────────────────────────────────────
    if (savingsAmt > 0) {
      await approvalsModel.createApprovalWithClient(
        client, 'savings_declaration', declaration.id,
        member_id, cycle_id, savingsAmt, user_id
      );
    }

    // ── 2. Loan request approval ─────────────────────────────────────────
    if (loanReqAmt > 0) {
      await approvalsModel.createApprovalWithClient(
        client, 'loan_request', declaration.id,
        member_id, cycle_id, loanReqAmt, user_id
      );
    }

    // ── 3. Loan repayment approval ───────────────────────────────────────
    if ((principalAmt + interestAmt) > 0) {
      if (!loan_id) {
        throw new Error('loan_id is required when submitting a repayment');
      }

      // Verify the loan belongs to this member
      const loanCheck = await client.query(
        'SELECT id FROM loans WHERE id = $1 AND member_id = $2 AND cycle_id = $3',
        [loan_id, member_id, cycle_id]
      );
      if (!loanCheck.rows[0]) throw new Error('Loan not found or does not belong to this member');

      // Generate unique reference
      const refNumber = `DECL-${member_id}-M${currentMonth}-${Date.now()}`;

      const repaymentResult = await client.query(
        `INSERT INTO loan_repayments
           (loan_id, member_id, cycle_id, amount, reference_number, payment_method,
            payment_proof_id, status, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
         RETURNING id`,
        [loan_id, member_id, cycle_id, principalAmt, refNumber,
         payment_method, payment_proof_id || null]
      );

      await approvalsModel.createApprovalWithClient(
        client, 'loan_repayment', repaymentResult.rows[0].id,
        member_id, cycle_id, principalAmt + interestAmt, user_id
      );
    }

    await client.query('COMMIT');
    return declaration;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateDeclarationStatus(declarationId, status) {
  const result = await db.query(
    `UPDATE declarations
     SET status = $1
     WHERE id = $2
     RETURNING id, member_id, cycle_id, month, status`,
    [status, declarationId]
  );
  if (!result.rows[0]) throw new Error('Declaration not found');
  return result.rows[0];
}

async function getDeclarationStats(cycleId, month) {
  const stats = await db.query(
    `SELECT
       COUNT(*)                                          AS total_declarations,
       COUNT(DISTINCT member_id)                         AS members_submitted,
       COUNT(CASE WHEN status = 'pending'   THEN 1 END) AS pending,
       COUNT(CASE WHEN status = 'approved'  THEN 1 END) AS approved,
       COUNT(CASE WHEN status = 'submitted' THEN 1 END) AS submitted,
       COUNT(CASE WHEN status = 'processed' THEN 1 END) AS processed,
       COUNT(CASE WHEN status = 'rejected'  THEN 1 END) AS rejected,
       COALESCE(SUM(savings_amount),       0)           AS total_savings_declared,
       COALESCE(SUM(loan_request),         0)           AS total_loans_requested,
       COALESCE(SUM(principal_repayment),  0)           AS total_principal_repayment,
       COALESCE(SUM(interest_repayment),   0)           AS total_interest_repayment
     FROM declarations
     WHERE cycle_id = $1 AND month = $2`,
    [cycleId, month]
  );

  const memberCountResult = await db.query(
    'SELECT COUNT(*) AS total_members FROM members WHERE cycle_id = $1 AND status = $2',
    [cycleId, 'active']
  );

  const totalMembers      = parseInt(memberCountResult.rows[0].total_members, 10);
  const membersSubmitted  = parseInt(stats.rows[0].members_submitted, 10);

  return {
    ...stats.rows[0],
    total_members: totalMembers,
    missing_declarations: totalMembers - membersSubmitted
  };
}

async function getMembersWithoutDeclaration(cycleId, month) {
  const result = await db.query(
    `SELECT m.id, u.full_name, u.email, u.phone
     FROM members m
     JOIN users u ON m.user_id = u.id
     LEFT JOIN declarations d ON m.id = d.member_id AND d.cycle_id = $1 AND d.month = $2
     WHERE m.cycle_id = $1 AND m.status = 'active' AND d.id IS NULL
     ORDER BY u.full_name ASC`,
    [cycleId, month]
  );
  return result.rows;
}

module.exports = {
  getDeclarationsByCycle,
  getDeclarationById,
  getMemberDeclaration,
  submitDeclaration,
  updateDeclarationStatus,
  getDeclarationStats,
  getMembersWithoutDeclaration
};
