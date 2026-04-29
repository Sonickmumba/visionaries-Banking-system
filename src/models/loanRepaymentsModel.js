const db = require('../config/database');
const approvalsModel = require('./approvalsModel');

async function generateReferenceNumber() {
  const result = await db.query('SELECT generate_reference_number() AS ref_number');
  return result.rows[0].ref_number;
}

async function createRepayment(loanId, amount, paymentMethod, paymentProofId, referenceNumber, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const loanResult = await client.query(
      `SELECT l.*, m.cycle_id, m.id AS member_id
       FROM loans l
       INNER JOIN members m ON l.member_id = m.id
       WHERE l.id = $1`,
      [loanId]
    );
    if (!loanResult.rows[0]) throw new Error('Loan not found');

    const loan = loanResult.rows[0];
    if (loan.status === 'repaid') throw new Error('Loan is already fully repaid');
    if (amount > loan.outstanding_balance) throw new Error('Repayment amount exceeds outstanding balance');

    const finalRefNumber = referenceNumber || await generateReferenceNumber();

    const repaymentResult = await client.query(
      `INSERT INTO loan_repayments
         (loan_id, member_id, cycle_id, amount, reference_number, payment_method,
          payment_proof_id, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING *`,
      [loanId, loan.member_id, loan.cycle_id, amount, finalRefNumber, paymentMethod, paymentProofId]
    );
    const repayment = repaymentResult.rows[0];

    await approvalsModel.createApproval(
      'loan_repayment',
      repayment.id,
      loan.member_id,
      loan.cycle_id,
      amount,
      userId
    );

    await client.query('COMMIT');
    return repayment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getRepaymentsByLoan(loanId) {
  const result = await db.query(
    `SELECT lr.*,
       uf.file_name, uf.file_type,
       reviewer.full_name AS reviewed_by_name
     FROM loan_repayments lr
     LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
     LEFT JOIN users reviewer   ON lr.reviewed_by       = reviewer.id
     WHERE lr.loan_id = $1
     ORDER BY lr.submitted_at DESC`,
    [loanId]
  );
  return result.rows;
}

async function getRepaymentsByMember(memberId, cycleId) {
  const result = await db.query(
    `SELECT lr.*, l.loan_type, l.amount AS loan_amount,
       uf.file_name, uf.file_type,
       reviewer.full_name AS reviewed_by_name
     FROM loan_repayments lr
     INNER JOIN loans l ON lr.loan_id = l.id
     LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
     LEFT JOIN users reviewer   ON lr.reviewed_by       = reviewer.id
     WHERE lr.member_id = $1 AND lr.cycle_id = $2
     ORDER BY lr.submitted_at DESC`,
    [memberId, cycleId]
  );
  return result.rows;
}

async function getRepaymentById(repaymentId) {
  const result = await db.query(
    `SELECT lr.*, l.loan_type, l.amount AS loan_amount, l.outstanding_balance,
       m.id AS member_id,
       u.full_name AS member_name, u.email AS member_email,
       uf.id AS file_id, uf.file_name, uf.file_type, uf.file_path,
       reviewer.full_name AS reviewed_by_name
     FROM loan_repayments lr
     INNER JOIN loans   l ON lr.loan_id   = l.id
     INNER JOIN members m ON lr.member_id = m.id
     INNER JOIN users   u ON m.user_id    = u.id
     LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
     LEFT JOIN users reviewer   ON lr.reviewed_by       = reviewer.id
     WHERE lr.id = $1`,
    [repaymentId]
  );
  return result.rows[0] || null;
}

async function getRepaymentsByCycle(cycleId, status = null) {
  let query = `
    SELECT lr.*, l.loan_type, l.amount AS loan_amount,
      m.id AS member_id,
      u.full_name AS member_name,
      uf.file_name, uf.file_type
    FROM loan_repayments lr
    INNER JOIN loans   l ON lr.loan_id   = l.id
    INNER JOIN members m ON lr.member_id = m.id
    INNER JOIN users   u ON m.user_id    = u.id
    LEFT JOIN uploaded_files uf ON lr.payment_proof_id = uf.id
    WHERE lr.cycle_id = $1
  `;
  const params = [cycleId];
  if (status) {
    query += ' AND lr.status = $2';
    params.push(status);
  }
  query += ' ORDER BY lr.submitted_at DESC';
  const result = await db.query(query, params);
  return result.rows;
}

async function referenceNumberExists(referenceNumber) {
  const result = await db.query(
    'SELECT id FROM loan_repayments WHERE reference_number = $1',
    [referenceNumber]
  );
  return result.rows.length > 0;
}

module.exports = {
  generateReferenceNumber,
  createRepayment,
  getRepaymentsByLoan,
  getRepaymentsByMember,
  getRepaymentById,
  getRepaymentsByCycle,
  referenceNumberExists
};
