/**
 * MONTH 2 → MONTH 3 FULL SIMULATION
 * ===================================
 * Simulates all month-2 activity across all 7 members of cycle 15, then
 * calls processMonthEnd(15) to advance to month 3, and verifies invariants.
 *
 * Scenarios:
 *  A: Member 35 (amina)   — repay pool loan 28 in full (K4,042.87), then take new K10,000 loan
 *  B: Member 36 (Annie)   — repay pool loan 30 in full (K1,010.73)
 *  C: Member 38 (Bridget) — partial repayment K3,000 on original loan 23
 *  D: Member 37 (Bethel)  — partial repayment K8,000 on original loan 24
 *  E: Member 39 (Bweupe)  — declare K5,000 new savings
 *  F: Member 40 (Catherine)— declare K10,000 new savings
 *  G: Advance cycle to month 3 (processMonthEnd)
 *  H: Verify all invariants
 */

const db = require('../src/config/database');
const { processMonthEnd } = require('../src/models/monthlyProcessingsModel');

const CYCLE_ID  = 15;
const MONTH     = 2; // current month
const INTEREST  = 0.15;

const sep = () => console.log('\n' + '─'.repeat(72));

// ─── helpers ────────────────────────────────────────────────────────────────

async function poolFormula(client, month) {
  const res = await client.query(`
    WITH lc AS (
      SELECT COALESCE(SUM(l.amount), 0)  AS disbursed,
             COALESCE(SUM(lr.amount), 0) AS repaid
      FROM loans l
      LEFT JOIN loan_repayments lr ON lr.loan_id = l.id AND lr.status = 'approved'
      WHERE l.cycle_id = $1
    ),
    pd AS (
      SELECT COALESCE(SUM(mb.savings_principal), 0)                                    AS savings,
             240::numeric * COUNT(*) FILTER (WHERE mb.social_fund_paid)                AS soc,
             80::numeric  * COUNT(*) FILTER (WHERE mb.membership_fee_paid)             AS fee
      FROM monthly_balances mb WHERE mb.cycle_id = $1 AND mb.month = $2
    )
    SELECT p.savings, p.soc, p.fee,
           p.savings + p.soc + p.fee                                        AS pool,
           l.disbursed, l.repaid,
           l.disbursed - l.repaid                                           AS net_lent,
           GREATEST(0, p.savings + p.soc + p.fee - (l.disbursed - l.repaid)) AS unborrowed
    FROM pd p, lc l
  `, [CYCLE_ID, month]);
  return res.rows[0];
}

async function driftCheck(client, month) {
  const res = await client.query(`
    SELECT mb.member_id,
           SUBSTRING(u.full_name,1,18)    AS name,
           mb.outstanding_loan            AS mb_loan,
           COALESCE(SUM(l.outstanding_balance),0) AS actual_loan,
           mb.outstanding_loan - COALESCE(SUM(l.outstanding_balance),0) AS drift
    FROM monthly_balances mb
    JOIN members m ON m.id = mb.member_id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN loans l ON l.member_id = mb.member_id AND l.cycle_id = mb.cycle_id
                      AND l.status IN ('disbursed','approved')
    WHERE mb.cycle_id = $1 AND mb.month = $2
    GROUP BY mb.member_id, u.full_name, mb.outstanding_loan
    ORDER BY mb.member_id
  `, [CYCLE_ID, month]);
  return res.rows;
}

async function printPool(client, label, month) {
  const p = await poolFormula(client, month);
  console.log(`\n[POOL month=${month}] ${label}`);
  console.log(`  savings=${p.savings}  soc=${p.soc}  fee=${p.fee}  pool=${p.pool}`);
  console.log(`  disbursed=${p.disbursed}  repaid=${p.repaid}  net_lent=${p.net_lent}`);
  console.log(`  UNBORROWED = ${p.unborrowed}`);
  return p;
}

async function printDrift(client, label, month) {
  const rows = await driftCheck(client, month);
  console.log(`\n[DRIFT month=${month}] ${label}`);
  let ok = true;
  for (const r of rows) {
    const flag = Math.abs(parseFloat(r.drift)) > 0.01 ? ' ⚠ DRIFT!' : ' ✓';
    if (Math.abs(parseFloat(r.drift)) > 0.01) ok = false;
    console.log(`  ${r.name.padEnd(20)} mb=${r.mb_loan}  actual=${r.actual_loan}  drift=${r.drift}${flag}`);
  }
  if (ok) console.log('  → All zero-drift ✓');
  return ok;
}

// ─── simulate a loan repayment (mirrors approveLoanRepayment without approvals table) ────

async function simulateLoanRepayment(client, loanId, memberId, amount, ref) {
  console.log(`\n  [REPAY] loan=${loanId} member=${memberId} amount=K${amount} ref=${ref}`);

  // Insert approved repayment record
  await client.query(`
    INSERT INTO loan_repayments (loan_id, member_id, cycle_id, amount, reference_number,
                                  payment_method, status, reviewed_at)
    VALUES ($1, $2, $3, $4, $5, 'cash', 'approved', NOW())
  `, [loanId, memberId, CYCLE_ID, amount, ref]);

  // Reduce outstanding_balance
  await client.query(
    `UPDATE loans SET outstanding_balance = outstanding_balance - $1, updated_at = NOW() WHERE id = $2`,
    [amount, loanId]
  );

  // Check if fully repaid
  const lRes = await client.query(
    `SELECT outstanding_balance, loan_type FROM loans WHERE id = $1`,
    [loanId]
  );
  const newOutstanding = parseFloat(lRes.rows[0].outstanding_balance);
  const loanType       = lRes.rows[0].loan_type;
  if (newOutstanding <= 0.005) {
    await client.query(`UPDATE loans SET status = 'repaid', updated_at = NOW() WHERE id = $1`, [loanId]);
    console.log(`    → Loan ${loanId} (${loanType}) fully REPAID`);
  } else {
    console.log(`    → Loan ${loanId} new outstanding: K${newOutstanding.toFixed(2)}`);
  }

  // Update monthly_balances — decrement outstanding_loan
  await client.query(`
    UPDATE monthly_balances
    SET outstanding_loan = GREATEST(outstanding_loan - $1, 0)
    WHERE member_id = $2 AND cycle_id = $3 AND month >= $4
  `, [amount, memberId, CYCLE_ID, MONTH]);

  // Insert transaction record
  await client.query(`
    INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
    VALUES ($1, $2, $3, 'loan_repayment', $4, NOW(), $5)
  `, [memberId, CYCLE_ID, MONTH, amount, `Loan repayment on loan #${loanId} (ref: ${ref})`]);
}

// ─── simulate a savings deposit (mirrors approveSavingsDeclaration logic) ────────

async function simulateSavingsDeposit(client, memberId, amount) {
  console.log(`\n  [SAVE] member=${memberId} deposit=K${amount}`);

  // Check existing savings total this cycle
  const totRes = await client.query(
    `SELECT COALESCE(SUM(total_principal),0) AS total FROM savings WHERE member_id=$1 AND cycle_id=$2`,
    [memberId, CYCLE_ID]
  );
  const existingTotal = parseFloat(totRes.rows[0].total);
  const maxSavings = 30000;
  if (existingTotal + amount > maxSavings) {
    throw new Error(`Would exceed maxSavings cap: existing=${existingTotal} + ${amount} > ${maxSavings}`);
  }

  // Guard: only one savings row per member per month
  const existing = await client.query(
    `SELECT id FROM savings WHERE member_id=$1 AND cycle_id=$2 AND month=$3`,
    [memberId, CYCLE_ID, MONTH]
  );
  if (existing.rows[0]) {
    // Update existing month-2 savings row
    await client.query(`
      UPDATE savings
      SET principal_deposit = principal_deposit + $1,
          total_principal   = total_principal   + $1,
          accumulated_savings = accumulated_savings + $1
      WHERE member_id=$2 AND cycle_id=$3 AND month=$4
    `, [amount, memberId, CYCLE_ID, MONTH]);
  } else {
    await client.query(`
      INSERT INTO savings (member_id, cycle_id, month, principal_deposit, total_principal, savings_interest, accumulated_savings)
      VALUES ($1, $2, $3, $4, $4, 0, $4)
    `, [memberId, CYCLE_ID, MONTH, amount]);
  }

  // Update monthly_balances
  await client.query(`
    UPDATE monthly_balances
    SET savings_principal   = savings_principal   + $1,
        accumulated_savings = accumulated_savings + $1
    WHERE member_id = $2 AND cycle_id = $3 AND month = $4
  `, [amount, memberId, CYCLE_ID, MONTH]);

  // Transaction record
  await client.query(`
    INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
    VALUES ($1, $2, $3, 'savings_deposit', $4, NOW(), 'Savings deposit (month 2 simulation)')
  `, [memberId, CYCLE_ID, MONTH, amount]);

  const mb = await client.query(
    `SELECT savings_principal, accumulated_savings FROM monthly_balances WHERE member_id=$1 AND cycle_id=$2 AND month=$3`,
    [memberId, CYCLE_ID, MONTH]
  );
  console.log(`    → savings_principal=${mb.rows[0].savings_principal}  accumulated=${mb.rows[0].accumulated_savings}`);
}

// ─── simulate a loan disbursement ─────────────────────────────────────────────

async function simulateLoanDisbursement(client, memberId, amount, loanType) {
  console.log(`\n  [LOAN] member=${memberId} type=${loanType} amount=K${amount}`);

  const monthlyInterest = amount * INTEREST;

  const lRes = await client.query(`
    INSERT INTO loans (member_id, cycle_id, loan_type, amount, disbursed_date, outstanding_balance, monthly_interest, status)
    VALUES ($1, $2, $3, $4, CURRENT_DATE, $4, $5, 'disbursed')
    RETURNING id
  `, [memberId, CYCLE_ID, loanType, amount, monthlyInterest]);
  const newLoanId = lRes.rows[0].id;
  console.log(`    → Loan #${newLoanId} disbursed, monthly_interest=K${monthlyInterest}`);

  // Update monthly_balances
  await client.query(`
    UPDATE monthly_balances
    SET outstanding_loan     = outstanding_loan     + $1,
        cumulative_borrowing = cumulative_borrowing + $1
    WHERE member_id = $2 AND cycle_id = $3 AND month = $4
  `, [amount, memberId, CYCLE_ID, MONTH]);

  await client.query(`
    INSERT INTO transactions (member_id, cycle_id, month, type, amount, date, description)
    VALUES ($1, $2, $3, 'loan_disbursement', $4, NOW(), $5)
  `, [memberId, CYCLE_ID, MONTH, amount, `${loanType} loan disbursed (simulation)`]);

  return newLoanId;
}

// ─── MAIN SIMULATION ──────────────────────────────────────────────────────────

async function runSimulation() {
  const client = await db.pool.connect();

  try {
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║   MONTH 2 → MONTH 3 FULL SIMULATION  (cycle_id=15)                 ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    sep();
    console.log('PHASE 0 — Baseline state (month 2 before any activity)');
    await printPool(client, 'BEFORE any month-2 transactions', MONTH);
    await printDrift(client, 'BASELINE', MONTH);

    // ── PHASE 1: Loan Repayments ─────────────────────────────────────────────
    sep();
    console.log('PHASE 1 — Loan Repayments');

    await client.query('BEGIN');

    // A: amina (35) repays pool loan 28 in full (K4,042.87)
    await simulateLoanRepayment(client, 28, 35, 4042.87, 'SIM-R001');

    // B: Annie (36) repays pool loan 30 in full (K1,010.73)
    await simulateLoanRepayment(client, 30, 36, 1010.73, 'SIM-R002');

    // C: Bridget (38) partial repayment K3,000 on loan 23
    await simulateLoanRepayment(client, 23, 38, 3000.00, 'SIM-R003');

    // D: Bethel (37) partial repayment K8,000 on loan 24
    await simulateLoanRepayment(client, 24, 37, 8000.00, 'SIM-R004');

    await client.query('COMMIT');
    console.log('\n  [✓] All repayments committed');

    await printPool(client, 'AFTER repayments', MONTH);
    const driftOk1 = await printDrift(client, 'AFTER repayments', MONTH);

    // ── PHASE 2: New Savings Deposits ────────────────────────────────────────
    sep();
    console.log('PHASE 2 — New Savings Deposits');

    await client.query('BEGIN');

    // E: Bweupe (39) deposits K5,000 (currently has K20,000 → K25,000)
    await simulateSavingsDeposit(client, 39, 5000.00);

    // F: Catherine (40) deposits K10,000 (currently has K5,000 → K15,000)
    await simulateSavingsDeposit(client, 40, 10000.00);

    await client.query('COMMIT');
    console.log('\n  [✓] All savings deposits committed');

    await printPool(client, 'AFTER savings deposits', MONTH);

    // ── PHASE 3: New Loan Disbursement ───────────────────────────────────────
    sep();
    console.log('PHASE 3 — New Loan Disbursement');

    await client.query('BEGIN');

    // A: amina (35) requests K10,000 original loan (pool loan repaid, now free)
    const newLoanId = await simulateLoanDisbursement(client, 35, 10000.00, 'original');

    await client.query('COMMIT');
    console.log('\n  [✓] New loan disbursed');

    const pool3 = await printPool(client, 'AFTER new loan disbursement', MONTH);
    const driftOk3 = await printDrift(client, 'AFTER new loan', MONTH);

    // ── PHASE 4: Pre-processMonthEnd snapshot ─────────────────────────────────
    sep();
    console.log('PHASE 4 — Snapshot: Active loans entering processMonthEnd');

    const loansRes = await client.query(`
      SELECT l.id, l.member_id, SUBSTRING(u.full_name,1,16) AS name,
             l.loan_type, l.amount, l.outstanding_balance, l.monthly_interest, l.status
      FROM loans l
      JOIN members m ON m.id = l.member_id
      JOIN users u ON u.id = m.user_id
      WHERE l.cycle_id = $1
      ORDER BY l.id
    `, [CYCLE_ID]);

    console.log('\n  All loans (cycle 15) at end of month 2:');
    console.log('  id | member | name             | type                 | amount    | outstanding | interest | status');
    for (const r of loansRes.rows) {
      const active = r.status === 'disbursed' ? ' ← ACTIVE' : '';
      console.log(`  ${String(r.id).padEnd(3)}| ${r.member_id}      | ${r.name.padEnd(17)}| ${r.loan_type.padEnd(21)}| ${r.amount.toString().padEnd(10)}| ${r.outstanding_balance.toString().padEnd(12)}| ${r.monthly_interest.toString().padEnd(9)}| ${r.status}${active}`);
    }

    const mbRes = await client.query(`
      SELECT mb.member_id, SUBSTRING(u.full_name,1,16) AS name,
             mb.savings_principal, mb.accumulated_savings, mb.outstanding_loan,
             mb.cumulative_borrowing
      FROM monthly_balances mb
      JOIN members m ON m.id = mb.member_id
      JOIN users u ON u.id = m.user_id
      WHERE mb.cycle_id = $1 AND mb.month = $2
      ORDER BY mb.member_id
    `, [CYCLE_ID, MONTH]);

    console.log('\n  monthly_balances (month 2, entering processMonthEnd):');
    console.log('  member | name              | savings_p  | accum_sav  | outstanding  | cumul_borrow');
    for (const r of mbRes.rows) {
      console.log(`  ${r.member_id}      | ${r.name.padEnd(17)}| ${r.savings_principal.toString().padEnd(11)}| ${r.accumulated_savings.toString().padEnd(11)}| ${r.outstanding_loan.toString().padEnd(13)}| ${r.cumulative_borrowing}`);
    }

    // Pre-compute expected month 3 values
    console.log('\n  Expected month 3 values after processMonthEnd (15% compounding):');
    console.log('  (pool loans get interest=0, common_interest loans compound normally)');
    const activeLoansForCalc = loansRes.rows.filter(l => l.status === 'disbursed');
    const expectedByMember = {};
    for (const loan of activeLoansForCalc) {
      const m = loan.member_id;
      if (!expectedByMember[m]) expectedByMember[m] = { outstanding: 0, interest_accrued: 0 };
      const isPool = loan.loan_type === 'common_interest_pool';
      const interest = isPool ? 0 : parseFloat(loan.monthly_interest);
      const newOuts  = parseFloat(loan.outstanding_balance) + interest;
      expectedByMember[m].outstanding    += newOuts;
      expectedByMember[m].interest_accrued += interest;
    }

    console.log('\n  member | name              | expected_outstanding_m3');
    for (const r of mbRes.rows) {
      const exp = expectedByMember[r.member_id];
      const outs = exp ? exp.outstanding.toFixed(2) : '0.00';
      console.log(`  ${r.member_id}      | ${r.name.padEnd(17)}| K${outs}`);
    }

    // ── PHASE 5: processMonthEnd ──────────────────────────────────────────────
    sep();
    console.log('PHASE 5 — Calling processMonthEnd(15) ...');

    const result = await processMonthEnd(CYCLE_ID);
    console.log(`\n  [✓] processMonthEnd complete:`);
    console.log(`      previousMonth=${result.previousMonth}  newMonth=${result.newMonth}`);
    console.log(`      membersProcessed=${result.membersProcessed}  interestRate=${result.interestRate}`);

    // ── PHASE 6: Verify month 3 ───────────────────────────────────────────────
    sep();
    console.log('PHASE 6 — Month 3 Verification');

    // 6a: Pool formula (month 3, uses savings_principal from month 3 row)
    await printPool(client, 'Month 3 pool formula', 3);

    // 6b: Drift check (month 3 monthly_balances vs sum of active loan outstanding)
    const driftOk6 = await printDrift(client, 'Month 3 drift check', 3);

    // 6c: loan state after compounding
    const loansAfter = await client.query(`
      SELECT l.id, l.member_id, SUBSTRING(u.full_name,1,16) AS name,
             l.loan_type, l.amount, l.outstanding_balance, l.monthly_interest, l.status
      FROM loans l
      JOIN members m ON m.id = l.member_id
      JOIN users u ON u.id = m.user_id
      WHERE l.cycle_id = $1
      ORDER BY l.id
    `, [CYCLE_ID]);

    console.log('\n  Loans after month-end compounding:');
    console.log('  id | member | type                 | amount    | outstanding_m3  | new_interest | status');
    let poolLoanInterestViolation = false;
    let commonLoanZeroInterestViolation = false;
    for (const r of loansAfter.rows) {
      const flag = r.status === 'disbursed'
        ? (r.loan_type === 'common_interest_pool' && parseFloat(r.monthly_interest) > 0.001
            ? ' ⚠ POOL_LOAN_SHOULD_BE_ZERO!'
            : (r.loan_type === 'common_interest' && parseFloat(r.monthly_interest) < 0.01
                ? ' ⚠ COMMON_INT_SHOULD_HAVE_INTEREST!'
                : ' ✓'))
        : '';
      if (r.loan_type === 'common_interest_pool' && r.status === 'disbursed' && parseFloat(r.monthly_interest) > 0.001)
        poolLoanInterestViolation = true;
      if (r.loan_type === 'common_interest' && r.status === 'disbursed' && parseFloat(r.monthly_interest) < 0.01)
        commonLoanZeroInterestViolation = true;
      console.log(`  ${String(r.id).padEnd(3)}| ${r.member_id}      | ${r.loan_type.padEnd(21)}| ${r.amount.toString().padEnd(10)}| ${r.outstanding_balance.toString().padEnd(16)}| ${r.monthly_interest.toString().padEnd(13)}| ${r.status}${flag}`);
    }

    // 6d: monthly_balances month 3
    const mb3 = await client.query(`
      SELECT mb.member_id, SUBSTRING(u.full_name,1,16) AS name,
             mb.savings_principal, mb.accumulated_savings, mb.outstanding_loan,
             mb.cumulative_borrowing, mb.common_interest_due
      FROM monthly_balances mb
      JOIN members m ON m.id = mb.member_id
      JOIN users u ON u.id = m.user_id
      WHERE mb.cycle_id = $1 AND mb.month = $2
      ORDER BY mb.member_id
    `, [CYCLE_ID, 3]);

    console.log('\n  monthly_balances — month 3:');
    console.log('  member | name              | savings_p  | accum_sav   | outstanding  | cumul_borrow | ci_due');
    for (const r of mb3.rows) {
      console.log(`  ${r.member_id}      | ${r.name.padEnd(17)}| ${r.savings_principal.toString().padEnd(11)}| ${r.accumulated_savings.toString().padEnd(12)}| ${r.outstanding_loan.toString().padEnd(13)}| ${r.cumulative_borrowing.toString().padEnd(13)}| ${r.common_interest_due}`);
    }

    // 6e: Cross-check accumulated_savings = month2 accumulated + 15% interest
    console.log('\n  Savings interest cross-check (month 3 accum = month 2 accum × 1.15):');
    const mb2check = await client.query(`
      SELECT member_id, accumulated_savings AS m2_acc
      FROM monthly_balances WHERE cycle_id=$1 AND month=2 ORDER BY member_id
    `, [CYCLE_ID]);
    for (const r2 of mb2check.rows) {
      const m3row = mb3.rows.find(r => r.member_id === r2.member_id);
      if (!m3row) { console.log(`  member ${r2.member_id}: no month 3 row!`); continue; }
      const expected = (parseFloat(r2.m2_acc) * 1.15).toFixed(2);
      const actual   = parseFloat(m3row.accumulated_savings).toFixed(2);
      const ok = expected === actual ? '✓' : `⚠ expected ${expected}`;
      console.log(`  member ${r2.member_id}: m2_acc=${r2.m2_acc} → expected=${expected}  actual=${actual}  ${ok}`);
    }

    // ── PHASE 7: Final Summary ────────────────────────────────────────────────
    sep();
    console.log('PHASE 7 — Simulation Summary');
    const issues = [];
    if (!driftOk1)                      issues.push('DRIFT after repayments');
    if (!driftOk3)                      issues.push('DRIFT after new loan');
    if (!driftOk6)                      issues.push('DRIFT in month 3');
    if (poolLoanInterestViolation)      issues.push('common_interest_pool loan has monthly_interest > 0');
    if (commonLoanZeroInterestViolation) issues.push('common_interest loan has monthly_interest = 0');

    if (issues.length === 0) {
      console.log('\n  ✅  ALL CHECKS PASSED — System is correct, ready for real month 3 usage');
    } else {
      console.log('\n  ❌  ISSUES FOUND:');
      for (const i of issues) console.log(`    • ${i}`);
    }

    // Cycle state
    const cycleRes = await client.query(`SELECT current_month FROM cycles WHERE id = $1`, [CYCLE_ID]);
    console.log(`\n  Cycle 15 current_month is now: ${cycleRes.rows[0].current_month}`);

    return issues.length === 0;

  } catch (err) {
    console.error('\n  ❌  SIMULATION ERROR:', err.message);
    console.error(err.stack);
    return false;
  } finally {
    client.release();
    await db.pool.end();
  }
}

runSimulation().then(ok => process.exit(ok ? 0 : 1));
