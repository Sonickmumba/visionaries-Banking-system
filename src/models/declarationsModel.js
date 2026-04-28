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
    user_id
  } = declarationData;

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

    if (!validateDeclarationWindow(new Date(), config)) {
      console.warn(`Declaration submitted outside window by member ${member_id}`);
    }

    const existingResult = await client.query(
      'SELECT id FROM declarations WHERE member_id = $1 AND cycle_id = $2 AND month = $3',
      [member_id, cycle_id, currentMonth]
    );
    if (existingResult.rows[0]) throw new Error('Declaration already submitted for this month');

    // Always require approval when savings are declared (payment_proof_id is optional but encouraged)
    const needsApproval = savings_amount > 0;
    const status = needsApproval ? 'pending' : 'submitted';

    const declarationResult = await client.query(
      `INSERT INTO declarations (
         member_id, cycle_id, month, submitted_at,
         savings_amount, loan_request, principal_repayment, interest_repayment,
         payment_proof_id, status
       ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9)
       RETURNING id, member_id, cycle_id, month, submitted_at, savings_amount,
                 loan_request, principal_repayment, interest_repayment, payment_proof_id, status`,
      [member_id, cycle_id, currentMonth, savings_amount, loan_request,
       principal_repayment, interest_repayment, payment_proof_id, status]
    );

    const declaration = declarationResult.rows[0];

    if (needsApproval) {
      await approvalsModel.createApproval(
        'savings_declaration',
        declaration.id,
        member_id,
        cycle_id,
        savings_amount,
        user_id
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
  const totalDeclarations = parseInt(stats.rows[0].total_declarations, 10);

  return {
    ...stats.rows[0],
    total_members: totalMembers,
    missing_declarations: totalMembers - totalDeclarations
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
