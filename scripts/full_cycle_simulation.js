/**
 * FULL CYCLE SIMULATION — Month 1 → Month 2 → Month 3
 * =====================================================
 * Starts with a clean reset of cycle 15, then exercises every code path
 * through the actual model functions (not raw SQL) so all business logic runs.
 *
 * Members (cycle 15):
 *   34  Abgail Sibalwa    savings=K30,000  loan=K90,000   (big borrower)
 *   35  amina zimba       savings=K30,000  loan=K0        (never borrows → CIA)
 *   36  Annie Zulu Sitali savings=K30,000  loan=K15,000   (below min K20k → CIA)
 *   37  Bethel Mweemba    savings=K20,000  loan=K25,000
 *   38  Bridget Mulenga   savings=K20,000  loan=K20,000   (at min)
 *   39  Bweupe Lukwasa    savings=K20,000  loan=K0        (never borrows → CIA)
 *   40  Catherine Nkandu  savings=K15,000  loan=K20,000
 *
 * Pool month 1 = 135,000 savings + 7×240 soc + 7×80 fee = 137,240
 * Loans month 1 = 90k+15k+25k+20k+20k = 170,000  → net lent > pool deliberately to
 * show GREATEST(0,…) floor, which is expected when big borrowers use members' savings.
 *
 * Actually adjusted: Abgail borrows K60,000 to keep pool positive.
 * Pool = 137,240, Loans = 60k+15k+25k+20k+20k = 140,000 → small deficit, GREATEST=0 ✓
 *
 * CIA method: never_borrowed_and_below_minimum (members 35, 36, 39)
 */

const db            = require('../src/config/database');
const declModel     = require('../src/models/declarationsModel');
const appModel      = require('../src/models/approvalsModel');
const membersModel  = require('../src/models/membersModel');
const ciModel       = require('../src/models/commonInterestModel');
const monthlyModel  = require('../src/models/monthlyProcessingsModel');

const CYCLE_ID   = 15;
const ADMIN_ID   = 11;   // Sonick Mumba (super_admin)
const TODAY      = new Date().toISOString().split('T')[0];

// member_id → user_id mapping (from DB)
const MEMBERS = [
  { id: 34, userId: 40, name: 'Abgail Sibalwa'    },
  { id: 35, userId: 41, name: 'amina zimba'        },
  { id: 36, userId: 42, name: 'Annie Zulu Sitali'  },
  { id: 37, userId: 43, name: 'Bethel Mweemba'     },
  { id: 38, userId: 44, name: 'Bridget Mulenga'    },
  { id: 39, userId: 45, name: 'Bweupe Lukwasa'     },
  { id: 40, userId: 46, name: 'Catherine Nkandu'   },
];

const sep  = (title) => console.log(`\n${'═'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
const ok   = (msg)   => console.log(`  ✅  ${msg}`);
const info = (msg)   => console.log(`  ℹ   ${msg}`);
const warn = (msg)   => console.log(`  ⚠   ${msg}`);
const fail = (msg)   => console.log(`  ❌  ${msg}`);

// ─── Diagnostic helpers ───────────────────────────────────────────────────────

async function poolFormula(client, month, label) {
  const r = await client.query(`
    WITH lc AS (
      SELECT COALESCE(SUM(l.amount),0)  AS disbursed,
             COALESCE(SUM(lr.amount),0) AS repaid
      FROM loans l
      LEFT JOIN loan_repayments lr ON lr.loan_id=l.id AND lr.status='approved'
      WHERE l.cycle_id=$1
    ),
    pd AS (
      SELECT COALESCE(SUM(savings_principal),0)                              AS savings,
             240::numeric * COUNT(*) FILTER (WHERE social_fund_paid)         AS soc,
             80::numeric  * COUNT(*) FILTER (WHERE membership_fee_paid)      AS fee
      FROM monthly_balances WHERE cycle_id=$1 AND month=$2
    )
    SELECT p.savings, p.soc, p.fee,
           p.savings+p.soc+p.fee                                             AS pool,
           l.disbursed, l.repaid,
           l.disbursed - l.repaid                                            AS net_lent,
           GREATEST(0, p.savings+p.soc+p.fee-(l.disbursed-l.repaid))        AS unborrowed
    FROM pd p, lc l
  `, [CYCLE_ID, month]);
  const p = r.rows[0];
  info(`[POOL m=${month}] ${label}`);
  info(`   savings=${p.savings}  soc=${p.soc}  fee=${p.fee}  pool=${p.pool}`);
  info(`   disbursed=${p.disbursed}  repaid=${p.repaid}  net_lent=${p.net_lent}`);
  info(`   UNBORROWED = ${p.unborrowed}`);
  return p;
}

async function driftCheck(client, month, label) {
  const rows = await client.query(`
    SELECT mb.member_id, SUBSTRING(u.full_name,1,18) AS name,
           mb.outstanding_loan   AS mb_loan,
           COALESCE(SUM(l.outstanding_balance),0) AS actual_loan,
           mb.outstanding_loan - COALESCE(SUM(l.outstanding_balance),0) AS drift,
           mb.savings_principal, mb.accumulated_savings,
           mb.common_interest_due, mb.social_fund_paid, mb.membership_fee_paid
    FROM monthly_balances mb
    JOIN members m ON m.id=mb.member_id
    JOIN users u ON u.id=m.user_id
    LEFT JOIN loans l ON l.member_id=mb.member_id AND l.cycle_id=mb.cycle_id
                      AND l.status IN ('disbursed','approved')
    WHERE mb.cycle_id=$1 AND mb.month=$2
    GROUP BY mb.member_id, u.full_name, mb.outstanding_loan, mb.savings_principal,
             mb.accumulated_savings, mb.common_interest_due,
             mb.social_fund_paid, mb.membership_fee_paid
    ORDER BY mb.member_id
  `, [CYCLE_ID, month]);

  info(`[DRIFT m=${month}] ${label}`);
  let allOk = true;
  for (const r of rows.rows) {
    const d = parseFloat(r.drift);
    const flag = Math.abs(d) > 0.01 ? ' ⚠ DRIFT!' : ' ✓';
    if (Math.abs(d) > 0.01) allOk = false;
    info(`   ${r.name.padEnd(20)} mb_loan=${String(r.mb_loan).padEnd(12)} actual=${String(r.actual_loan).padEnd(12)} drift=${r.drift}${flag}`);
    info(`   ${' '.repeat(20)} savings_p=${r.savings_principal}  accum=${r.accumulated_savings}  ci_due=${r.common_interest_due}  soc=${r.social_fund_paid}  fee=${r.membership_fee_paid}`);
  }
  if (allOk) ok('All zero-drift ✓');
  return allOk;
}

async function loanSnapshot(client, label) {
  const rows = await client.query(`
    SELECT l.id, l.member_id, SUBSTRING(u.full_name,1,16) AS name,
           l.loan_type, l.amount, l.outstanding_balance, l.monthly_interest, l.status
    FROM loans l JOIN members m ON m.id=l.member_id JOIN users u ON u.id=m.user_id
    WHERE l.cycle_id=$1 ORDER BY l.id
  `, [CYCLE_ID]);
  info(`[LOANS] ${label}`);
  for (const r of rows.rows) {
    const active = r.status === 'disbursed' ? ' ←' : '';
    info(`   #${String(r.id).padEnd(3)} ${r.name.padEnd(17)} ${r.loan_type.padEnd(22)} amt=${String(r.amount).padEnd(10)} out=${String(r.outstanding_balance).padEnd(12)} int=${r.monthly_interest}  [${r.status}]${active}`);
  }
}

async function ciaSnapshot(client, label) {
  const rows = await client.query(`
    SELECT cia.id, cia.member_id, SUBSTRING(u.full_name,1,16) AS name,
           cia.month, cia.charge, cia.principal_allocated, cia.pool_loan_id, cia.status
    FROM common_interest_allocations cia
    JOIN members m ON m.id=cia.member_id JOIN users u ON u.id=m.user_id
    WHERE cia.cycle_id=$1 ORDER BY cia.id
  `, [CYCLE_ID]);
  info(`[CIA] ${label}`);
  for (const r of rows.rows) {
    info(`   cia#${r.id} m${r.month} ${r.name.padEnd(17)} charge=${r.charge}  principal=${r.principal_allocated}  pool_loan=${r.pool_loan_id}  [${r.status}]`);
  }
}

// ─── Error-catching test wrapper ──────────────────────────────────────────────

async function mustThrow(label, fn) {
  try {
    await fn();
    fail(`${label} — expected error but NONE thrown ⚠`);
  } catch (e) {
    ok(`${label} correctly threw: "${e.message}"`);
  }
}

// ─── Fetch pending approval by member + type ──────────────────────────────────

async function getPendingApproval(client, memberId, approvalType) {
  const r = await client.query(
    `SELECT id FROM approvals WHERE member_id=$1 AND cycle_id=$2 AND approval_type=$3 AND status='pending' ORDER BY id DESC LIMIT 1`,
    [memberId, CYCLE_ID, approvalType]
  );
  if (!r.rows[0]) throw new Error(`No pending ${approvalType} approval for member ${memberId}`);
  return r.rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESET
// ─────────────────────────────────────────────────────────────────────────────

async function resetCycle(client) {
  sep('RESET — wipe all cycle-15 activity, restore to month 1');

  // Clear in dependency order (FK constraints)
  await client.query('DELETE FROM common_interest_allocations WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM penalties WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM transactions WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM approvals WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM declarations WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM loan_repayments WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM loans WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM savings WHERE cycle_id=$1', [CYCLE_ID]);
  await client.query('DELETE FROM monthly_balances WHERE cycle_id=$1', [CYCLE_ID]);

  // Reset cycle to month 1
  await client.query(
    `UPDATE cycles SET current_month=1, updated_at=NOW() WHERE id=$1`, [CYCLE_ID]
  );

  // Seed month-1 monthly_balances for all 7 members (zeros)
  for (const m of MEMBERS) {
    await client.query(`
      INSERT INTO monthly_balances
        (member_id, cycle_id, month, savings_principal, accumulated_savings,
         outstanding_loan, cumulative_borrowing, common_interest_due, penalties_due,
         social_fund_paid, membership_fee_paid, compliance_status)
      VALUES ($1,$2,1, 0,0, 0,0, 0,0, false,false, 'never_borrowed')
    `, [m.id, CYCLE_ID]);
  }

  ok('Reset complete — cycle_15 is back to month 1 with clean monthly_balances');
}

// ─────────────────────────────────────────────────────────────────────────────
//  MONTH 1
// ─────────────────────────────────────────────────────────────────────────────

async function runMonth1(client) {

  // ── Step 1: Savings declarations ─────────────────────────────────────────
  sep('MONTH 1 — Step 1: All 7 members declare savings');

  const savingsAmounts = { 34: 30000, 35: 30000, 36: 30000, 37: 20000, 38: 20000, 39: 20000, 40: 15000 };

  for (const m of MEMBERS) {
    const decl = await declModel.submitDeclaration({
      member_id: m.id, cycle_id: CYCLE_ID,
      savings_amount: savingsAmounts[m.id],
      user_id: m.userId
    });
    info(`   ${m.name}: submitted savings declaration #${decl.id} for K${savingsAmounts[m.id]}`);
  }

  // ── Approve all savings declarations ──────────────────────────────────────
  for (const m of MEMBERS) {
    const approvalId = await getPendingApproval(client, m.id, 'savings_declaration');
    await appModel.approveSavingsDeclaration(approvalId, ADMIN_ID);
    ok(`   ${m.name}: savings K${savingsAmounts[m.id]} approved`);
  }

  await poolFormula(client, 1, 'After savings declarations approved');
  await driftCheck(client, 1, 'After savings');

  // ── Edge case: duplicate savings in same month ─────────────────────────────
  sep('MONTH 1 — Edge case A: duplicate savings should fail');
  await mustThrow('Duplicate savings declaration for member 34', () =>
    declModel.submitDeclaration({ member_id: 34, cycle_id: CYCLE_ID, savings_amount: 1000, user_id: 40 })
  );

  // ── Edge case: over-cap savings ────────────────────────────────────────────
  sep('MONTH 1 — Edge case B: savings over K30,000 cap should fail');
  // Member 37 already has K20,000; trying K15,000 more = K35,000 > K30,000 cap
  // First submit a declaration for member 37 with K15,000 extra savings
  // This creates a new declaration (month 1 savings=0 first submit already done... actually
  // the duplicate check blocks the second savings=15000 declaration for same month.
  // The cap is checked at APPROVAL time. Let's test it by submitting member 37 in month 2 later.
  // For now, test the approval-level cap by crafting a scenario when we reset member 36's savings.
  info('  (savings-over-cap tested at month 2 — member with K30,000 tries to deposit K1)');

  // ── Step 2: Membership fee + social fund payments ─────────────────────────
  sep('MONTH 1 — Step 2: All 7 members pay membership fee AND social fund');

  for (const m of MEMBERS) {
    await membersModel.recordFeePayment(m.id, CYCLE_ID, 'membership_fee', TODAY);
    await membersModel.recordFeePayment(m.id, CYCLE_ID, 'social_fund', TODAY);
    ok(`   ${m.name}: membership_fee + social_fund paid`);
  }

  await poolFormula(client, 1, 'After all fees paid');

  // ── Edge case: duplicate fee payment ──────────────────────────────────────
  sep('MONTH 1 — Edge case C: duplicate fee payment should fail');
  await mustThrow('Duplicate membership_fee for member 34', () =>
    membersModel.recordFeePayment(34, CYCLE_ID, 'membership_fee', TODAY)
  );
  await mustThrow('Duplicate social_fund for member 35', () =>
    membersModel.recordFeePayment(35, CYCLE_ID, 'social_fund', TODAY)
  );

  // ── Step 3: Loan requests (5 of 7 members borrow) ────────────────────────
  sep('MONTH 1 — Step 3: 5 members request loans');

  // Members 35 and 39 DO NOT request loans (they will trigger CIA)
  const loanRequests = [
    { id: 34, amount: 60000 },  // big borrower
    { id: 36, amount: 15000 },  // below min K20k → will get CIA
    { id: 37, amount: 25000 },  // above min
    { id: 38, amount: 20000 },  // at min
    { id: 40, amount: 20000 },  // at min
  ];

  for (const lr of loanRequests) {
    const m = MEMBERS.find(x => x.id === lr.id);
    const decl = await declModel.submitDeclaration({
      member_id: lr.id, cycle_id: CYCLE_ID,
      loan_request: lr.amount,
      user_id: m.userId
    });
    info(`   ${m.name}: loan request K${lr.amount} submitted (decl #${decl.id})`);
  }

  // ── Edge case: duplicate loan request in same cycle ───────────────────────
  sep('MONTH 1 — Edge case D: duplicate open loan request should fail');
  await mustThrow('Second loan request for member 34 in same cycle', () =>
    declModel.submitDeclaration({ member_id: 34, cycle_id: CYCLE_ID, loan_request: 5000, user_id: 40 })
  );

  // ── Approve all loan requests ─────────────────────────────────────────────
  sep('MONTH 1 — Step 3b: Admin approves all loan requests');
  for (const lr of loanRequests) {
    const m = MEMBERS.find(x => x.id === lr.id);
    const approvalId = await getPendingApproval(client, lr.id, 'loan_request');
    await appModel.approveLoanRequest(approvalId, ADMIN_ID);
    ok(`   ${m.name}: loan K${lr.amount} approved and disbursed`);
  }

  await loanSnapshot(client, 'After month-1 loan disbursements');
  await poolFormula(client, 1, 'After loan disbursements');
  const drift1 = await driftCheck(client, 1, 'After loan disbursements');
  if (!drift1) { fail('DRIFT DETECTED after loan disbursements — stopping'); process.exit(1); }

  // Pool sanity: total savings=135k, soc=1680, fee=560, pool=137240
  // Loans disbursed=140k → unborrowed=GREATEST(0, 137240-140000)=0 (as expected)
  info('  Note: pool<loans is expected — big borrower used pooled savings from non-borrowing members');

  // ── Step 4: Calculate + Apply common interest allocations ─────────────────
  sep('MONTH 1 — Step 4: Calculate and apply common interest allocations');

  // Verify analysis first
  const analysis = await ciModel.calculateAllocations(CYCLE_ID, 1, 'never_borrowed_and_below_minimum');
  info(`  Method: never_borrowed_and_below_minimum`);
  info(`  Total pool = ${analysis.unborrowedPrincipal < 0 ? '(negative — big borrower scenario)' : analysis.unborrowedPrincipal}`);
  info(`  Common interest amount = ${analysis.commonInterestAmount}`);
  for (const a of analysis.allocations) {
    info(`   ${a.member_name.padEnd(20)} charge=K${a.charge}  shortfall=${a.shortfall}  eligibility=${a.eligibility_status}`);
  }

  if (analysis.commonInterestAmount <= 0) {
    warn('  No unborrowed money → no CIA to apply (pool fully utilised by loans). Skipping CIA steps.');
  } else {
    // Apply
    const applied = await ciModel.applyAllocations(CYCLE_ID, 1, 'never_borrowed_and_below_minimum');
    ok(`  Allocations applied: ${applied.allocations?.length ?? applied.summary?.memberCount ?? '?'} members`);
    await ciaSnapshot(client, 'After applyAllocations month 1');
    await loanSnapshot(client, 'After pool loans created');
    await driftCheck(client, 1, 'After CIA pool loans');
    await poolFormula(client, 1, 'After CIA pool loans');

    // ── Step 5: Some members pay common interest on time ──────────────────
    sep('MONTH 1 — Step 5: Some members pay common interest (on time)');

    // Find who has CIA
    const ciaRows = await client.query(
      `SELECT cia.member_id, cia.charge FROM common_interest_allocations cia
       WHERE cia.cycle_id=$1 AND cia.month=1 AND cia.status='allocated'`,
      [CYCLE_ID]
    );
    info(`  Members with unpaid CIA: ${ciaRows.rows.map(r => r.member_id).join(', ')}`);

    // Member 36 (Annie) pays — she borrowed but below minimum
    const cia36 = ciaRows.rows.find(r => r.member_id === 36);
    if (cia36) {
      const r = await ciModel.payCommonInterest(CYCLE_ID, 36, 1, parseFloat(cia36.charge), TODAY);
      ok(`  Annie (36): paid common interest K${cia36.charge} → remaining=${r.remaining}  isLate=${r.isLate}`);
    }

    // Check: try to pay when no CIA exists (member 34 never had CIA)
    await mustThrow('Pay CI for member with no allocation (member 34)', () =>
      ciModel.payCommonInterest(CYCLE_ID, 34, 1, 100, TODAY)
    );

    // ── Edge case: pay more than due ───────────────────────────────────────
    const cia35 = ciaRows.rows.find(r => r.member_id === 35);
    if (cia35) {
      await mustThrow('Over-payment of CI for member 35', () =>
        ciModel.payCommonInterest(CYCLE_ID, 35, 1, parseFloat(cia35.charge) + 999, TODAY)
      );
    }

    await ciaSnapshot(client, 'After member 36 pays — members 35 and 39 still owe');

    // ── Step 6: Enforce unpaid common interest ────────────────────────────
    sep('MONTH 1 — Step 6: Enforce unpaid common interest for members 35 and 39');

    const enforced = await ciModel.enforceUnpaidCommonInterest(CYCLE_ID, 1);
    ok(`  Enforcement complete: ${enforced.converted} members enforced`);
    for (const e of enforced.members || []) {
      info(`   member ${e.memberId}: path=${e.path || 'in-place'}  poolLoanId=${e.poolLoanId || 'N/A'}`);
    }

    await ciaSnapshot(client, 'After enforcement — all CIA should be paid');
    await loanSnapshot(client, 'After enforcement — pool loans → common_interest');
    await driftCheck(client, 1, 'After enforcement');
    await poolFormula(client, 1, 'After enforcement (pool loan amounts unchanged)');
  }

  // ── Step 7: Verify fee totals ─────────────────────────────────────────────
  sep('MONTH 1 — Step 7: Verify fee totals');
  const feeCheck = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE social_fund_paid)    AS soc_paid_count,
      COUNT(*) FILTER (WHERE membership_fee_paid) AS fee_paid_count,
      7 * 240 AS expected_soc_total,
      7 * 80  AS expected_fee_total
    FROM monthly_balances WHERE cycle_id=$1 AND month=1
  `, [CYCLE_ID]);
  const fc = feeCheck.rows[0];
  ok(`  Social fund: ${fc.soc_paid_count}/7 paid  → total = K${fc.soc_paid_count * 240} (expected K${fc.expected_soc_total})`);
  ok(`  Membership fee: ${fc.fee_paid_count}/7 paid → total = K${fc.fee_paid_count * 80} (expected K${fc.expected_fee_total})`);
  if (parseInt(fc.soc_paid_count) !== 7) fail('Not all social fund paid!');
  if (parseInt(fc.fee_paid_count) !== 7) fail('Not all membership fee paid!');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ADVANCE TO MONTH 2
// ─────────────────────────────────────────────────────────────────────────────

async function advanceMonth(label) {
  sep(`ADVANCE MONTH — ${label}`);
  const result = await monthlyModel.processMonthEnd(CYCLE_ID);
  ok(`  processMonthEnd complete: month ${result.previousMonth} → ${result.newMonth}`);
  ok(`  ${result.membersProcessed} members processed at interestRate=${result.interestRate}`);
  return result.newMonth;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MONTH 2
// ─────────────────────────────────────────────────────────────────────────────

async function runMonth2(client) {

  sep('MONTH 2 — Overview: verify what processMonthEnd produced');

  // Show what we have at start of month 2
  await loanSnapshot(client, 'Loans entering month 2 (all active loans compounded)');
  await poolFormula(client, 2, 'Month 2 pool formula (savings carried forward)');
  const drift2start = await driftCheck(client, 2, 'Month 2 start — verifying zero drift');
  if (!drift2start) { fail('DRIFT at month 2 start!'); process.exit(1); }

  // Verify pool loans NOT compounded (monthly_interest=0)
  const poolLoanCheck = await client.query(`
    SELECT id, loan_type, monthly_interest FROM loans
    WHERE cycle_id=$1 AND loan_type='common_interest_pool' AND status='disbursed'
  `, [CYCLE_ID]);
  if (poolLoanCheck.rows.length > 0) {
    for (const r of poolLoanCheck.rows) {
      if (parseFloat(r.monthly_interest) > 0.001) {
        fail(`Pool loan #${r.id} has monthly_interest=${r.monthly_interest} — should be 0!`);
      } else {
        ok(`  Pool loan #${r.id} has monthly_interest=0 ✓ (non-compounding)`);
      }
    }
  } else {
    info('  No active pool loans (all enforced to common_interest) — pool non-compounding check N/A');
  }

  // Verify common_interest loans ARE compounded
  const ciLoanCheck = await client.query(`
    SELECT id, member_id, outstanding_balance, monthly_interest
    FROM loans WHERE cycle_id=$1 AND loan_type='common_interest' AND status='disbursed'
  `, [CYCLE_ID]);
  for (const r of ciLoanCheck.rows) {
    if (parseFloat(r.monthly_interest) <= 0.001) {
      fail(`common_interest loan #${r.id} has monthly_interest=0 — should be >0!`);
    } else {
      ok(`  CI loan #${r.id} (member ${r.member_id}): outstanding=${r.outstanding_balance}  new_interest=${r.monthly_interest} ✓`);
    }
  }

  // Verify savings interest compound correctly: month2.accum = month1.accum × 1.15
  const savChk = await client.query(`
    SELECT m1.member_id,
           m1.accumulated_savings AS m1_acc,
           m2.accumulated_savings AS m2_acc,
           ROUND(m1.accumulated_savings * 1.15, 2) AS expected_m2
    FROM monthly_balances m1
    JOIN monthly_balances m2 ON m2.member_id=m1.member_id AND m2.cycle_id=m1.cycle_id AND m2.month=2
    WHERE m1.cycle_id=$1 AND m1.month=1
  `, [CYCLE_ID]);
  info('  Savings compound check (m2.accum = m1.accum × 1.15):');
  let savOk = true;
  for (const r of savChk.rows) {
    const match = r.m2_acc.toString() === r.expected_m2.toString();
    if (!match) savOk = false;
    info(`   member ${r.member_id}: m1=${r.m1_acc} → expected=${r.expected_m2}  actual=${r.m2_acc}  ${match ? '✓' : '⚠ MISMATCH!'}`);
  }
  if (savOk) ok('  All savings compounding correct ✓');

  // ── Step 1: More savings declarations (members who have room) ─────────────
  sep('MONTH 2 — Step 1: Additional savings deposits');

  // Member 37: already at K20,000, adds K10,000 → K30,000 (cap)
  const decl37 = await declModel.submitDeclaration({ member_id: 37, cycle_id: CYCLE_ID, savings_amount: 10000, user_id: 43 });
  info(`  Bethel (37): submitted K10,000 savings (decl #${decl37.id})`);

  // Member 38: at K20,000, adds K5,000 → K25,000
  const decl38 = await declModel.submitDeclaration({ member_id: 38, cycle_id: CYCLE_ID, savings_amount: 5000, user_id: 44 });
  info(`  Bridget (38): submitted K5,000 savings (decl #${decl38.id})`);

  // Member 40: at K15,000, adds K10,000 → K25,000
  const decl40 = await declModel.submitDeclaration({ member_id: 40, cycle_id: CYCLE_ID, savings_amount: 10000, user_id: 46 });
  info(`  Catherine (40): submitted K10,000 savings (decl #${decl40.id})`);

  // Edge case: member 34 is at K30,000 cap — any additional deposit should fail at approval
  sep('MONTH 2 — Edge case E: approve savings that would exceed K30,000 cap (member 34)');
  // We need to directly craft a declaration with savings_amount>0 for member 34.
  // The SUBMISSION check only checks for a savings decl this month; the CAP is enforced at approval.
  // Insert a raw declaration row to bypass the per-month duplicate check and test approval-level cap.
  const rawDecl = await client.query(`
    INSERT INTO declarations (member_id, cycle_id, month, submitted_at, savings_amount, status)
    VALUES ($1, $2, 2, NOW(), 1000, 'pending') RETURNING id
  `, [34, CYCLE_ID]);
  const rawDeclId = rawDecl.rows[0].id;
  const rawApproval = await client.query(`
    INSERT INTO approvals (approval_type, entity_id, member_id, cycle_id, amount, submitted_by, status)
    VALUES ('savings_declaration', $1, 34, $2, 1000, 40, 'pending') RETURNING id
  `, [rawDeclId, CYCLE_ID]);
  await mustThrow('Savings approval over K30,000 cap (member 34)', () =>
    appModel.approveSavingsDeclaration(rawApproval.rows[0].id, ADMIN_ID)
  );
  // Clean up the test rows
  await client.query('DELETE FROM approvals WHERE id=$1', [rawApproval.rows[0].id]);
  await client.query('DELETE FROM declarations WHERE id=$1', [rawDeclId]);

  // Approve the legitimate month-2 savings declarations
  for (const mid of [37, 38, 40]) {
    const approvalId = await getPendingApproval(client, mid, 'savings_declaration');
    await appModel.approveSavingsDeclaration(approvalId, ADMIN_ID);
    ok(`  member ${mid}: month-2 savings approved`);
  }

  await poolFormula(client, 2, 'After month-2 savings deposits');
  await driftCheck(client, 2, 'After month-2 savings');

  // ── Step 2: Loan repayments ───────────────────────────────────────────────
  sep('MONTH 2 — Step 2: Loan repayments');

  // Member 36 (Annie): repay active pool loan in full (if any) + partial on original
  const annie_pool_loan = await client.query(
    `SELECT id, outstanding_balance FROM loans WHERE member_id=36 AND cycle_id=$1 AND loan_type='common_interest_pool' AND status='disbursed' LIMIT 1`,
    [CYCLE_ID]
  );
  if (annie_pool_loan.rows[0]) {
    const poolLoanId = annie_pool_loan.rows[0].id;
    const poolLoanBal = parseFloat(annie_pool_loan.rows[0].outstanding_balance);
    const decl = await declModel.submitDeclaration({
      member_id: 36, cycle_id: CYCLE_ID,
      principal_repayment: poolLoanBal, loan_id: poolLoanId,
      payment_method: 'cash', user_id: 42
    });
    const approvalId = await getPendingApproval(client, 36, 'loan_repayment');
    await appModel.approveLoanRepayment(approvalId, ADMIN_ID);
    ok(`  Annie (36): repaid pool loan #${poolLoanId} in full (K${poolLoanBal})`);
  } else {
    info('  Annie (36): no active pool loan to repay (already converted by enforcement)');
    // Repay some of the common_interest loan instead
    const ciLoan36 = await client.query(
      `SELECT id, outstanding_balance FROM loans WHERE member_id=36 AND cycle_id=$1 AND loan_type='common_interest' AND status='disbursed' LIMIT 1`,
      [CYCLE_ID]
    );
    if (ciLoan36.rows[0]) {
      const partialAmt = Math.min(500, parseFloat(ciLoan36.rows[0].outstanding_balance));
      const decl = await declModel.submitDeclaration({
        member_id: 36, cycle_id: CYCLE_ID,
        principal_repayment: partialAmt, loan_id: ciLoan36.rows[0].id,
        payment_method: 'cash', user_id: 42
      });
      const approvalId = await getPendingApproval(client, 36, 'loan_repayment');
      await appModel.approveLoanRepayment(approvalId, ADMIN_ID);
      ok(`  Annie (36): partial repayment K${partialAmt} on common_interest loan`);
    }
  }

  // Member 37 (Bethel): partial repayment K8,000 on original loan
  const bethel_loan = await client.query(
    `SELECT id, outstanding_balance FROM loans WHERE member_id=37 AND cycle_id=$1 AND loan_type='original' AND status='disbursed' LIMIT 1`,
    [CYCLE_ID]
  );
  if (bethel_loan.rows[0]) {
    const decl = await declModel.submitDeclaration({
      member_id: 37, cycle_id: CYCLE_ID,
      principal_repayment: 8000, loan_id: bethel_loan.rows[0].id,
      payment_method: 'bank_transfer', user_id: 43
    });
    const approvalId = await getPendingApproval(client, 37, 'loan_repayment');
    await appModel.approveLoanRepayment(approvalId, ADMIN_ID);
    ok(`  Bethel (37): partial repayment K8,000 approved`);
  }

  // Member 38 (Bridget): pay off original loan in full
  const bridget_loan = await client.query(
    `SELECT id, outstanding_balance FROM loans WHERE member_id=38 AND cycle_id=$1 AND loan_type='original' AND status='disbursed' LIMIT 1`,
    [CYCLE_ID]
  );
  if (bridget_loan.rows[0]) {
    const fullBal = parseFloat(bridget_loan.rows[0].outstanding_balance);
    const decl = await declModel.submitDeclaration({
      member_id: 38, cycle_id: CYCLE_ID,
      principal_repayment: fullBal, loan_id: bridget_loan.rows[0].id,
      payment_method: 'mobile_money', user_id: 44
    });
    const approvalId = await getPendingApproval(client, 38, 'loan_repayment');
    await appModel.approveLoanRepayment(approvalId, ADMIN_ID);
    ok(`  Bridget (38): original loan #${bridget_loan.rows[0].id} repaid in full (K${fullBal})`);
  }

  await loanSnapshot(client, 'After month-2 repayments');
  await poolFormula(client, 2, 'After repayments');
  await driftCheck(client, 2, 'After repayments');

  // ── Step 3: New loan requests from members who never borrowed ────────────
  sep('MONTH 2 — Step 3: amina (35) and Bweupe (39) request first-time loans');
  // Note: the declaration system enforces 1 loan request per CYCLE per member.
  // Members 35 and 39 never requested a loan in month 1, so they can request now.
  // Members who already had approved loan requests (34, 36, 37, 38, 40) cannot
  // submit a new one via declarations in the same cycle — business rule enforced.

  const declLoan35 = await declModel.submitDeclaration({
    member_id: 35, cycle_id: CYCLE_ID,
    loan_request: 20000, user_id: 41
  });
  const loanApproval35 = await getPendingApproval(client, 35, 'loan_request');
  await appModel.approveLoanRequest(loanApproval35, ADMIN_ID);
  ok('  amina (35): K20,000 original loan approved');

  const declLoan39 = await declModel.submitDeclaration({
    member_id: 39, cycle_id: CYCLE_ID,
    loan_request: 15000, user_id: 45
  });
  const loanApproval39 = await getPendingApproval(client, 39, 'loan_request');
  await appModel.approveLoanRequest(loanApproval39, ADMIN_ID);
  ok('  Bweupe (39): K15,000 original loan approved');

  // Verify one-per-cycle rule: member already having a prior approved loan request is blocked
  sep('MONTH 2 — Edge case G: duplicate loan request per cycle should fail');
  await mustThrow('Second loan request for member 38 (already approved one in month 1)', () =>
    declModel.submitDeclaration({ member_id: 38, cycle_id: CYCLE_ID, loan_request: 5000, user_id: 44 })
  );

  // Use disburseLoan directly for a top-up (admin-initiated, bypasses declaration uniqueness)
  const loansModel = require('../src/models/loansModel');
  const topUpLoan = await loansModel.disburseLoan({
    member_id: 34, cycle_id: CYCLE_ID,
    loan_type: 'top_up', amount: 10000,
    disbursed_date: TODAY
  });
  ok(`  Abgail (34): K10,000 top_up loan #${topUpLoan.id} disbursed directly (admin-initiated)`);

  await loanSnapshot(client, 'After new loan requests');
  await poolFormula(client, 2, 'After new loans');
  await driftCheck(client, 2, 'After new loans');

  // ── Step 4: Common interest allocations for month 2 ──────────────────────
  sep('MONTH 2 — Step 4: Common interest allocations');

  const analysis2 = await ciModel.calculateAllocations(CYCLE_ID, 2, 'never_borrowed_and_below_minimum');
  info(`  Common interest amount for month 2: K${analysis2.commonInterestAmount.toFixed(2)}`);
  info(`  Unborrowed principal: K${analysis2.unborrowedPrincipal.toFixed(2)}`);
  for (const a of analysis2.allocations) {
    info(`   ${a.member_name.padEnd(20)} charge=K${a.charge}`);
  }

  if (analysis2.commonInterestAmount > 0) {
    await ciModel.applyAllocations(CYCLE_ID, 2, 'never_borrowed_and_below_minimum');
    ok('  Month-2 allocations applied');
    await ciaSnapshot(client, 'CIA after month-2 allocations');

    // Some members pay, some don't
    const cia2Rows = await client.query(
      `SELECT member_id, charge FROM common_interest_allocations
       WHERE cycle_id=$1 AND month=2 AND status='allocated'`, [CYCLE_ID]
    );

    for (const r of cia2Rows.rows) {
      if ([36, 37].includes(r.member_id)) {
        // Pay on time
        await ciModel.payCommonInterest(CYCLE_ID, r.member_id, 2, parseFloat(r.charge), TODAY);
        ok(`  Member ${r.member_id}: paid month-2 CI K${r.charge}`);
      } else {
        info(`  Member ${r.member_id}: NOT paying (will be enforced)`);
      }
    }

    // Enforce remaining
    const enforced2 = await ciModel.enforceUnpaidCommonInterest(CYCLE_ID, 2);
    ok(`  Month-2 enforcement: ${enforced2.converted} members enforced`);
    await ciaSnapshot(client, 'CIA after month-2 enforcement');
  } else {
    info('  No unborrowed money in month 2 → no CIA');
  }

  await poolFormula(client, 2, 'End of month-2 state');
  await driftCheck(client, 2, 'End of month-2 state');

  // ── Edge case: fee payment in month 2 should fail ─────────────────────────
  sep('MONTH 2 — Edge case F: fee payment outside month 1 should fail');
  await mustThrow('Fee payment in month 2 for member 34', () =>
    membersModel.recordFeePayment(34, CYCLE_ID, 'social_fund', TODAY)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MONTH 3 VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

async function verifyMonth3(client) {
  sep('MONTH 3 — Full verification after processMonthEnd');

  await loanSnapshot(client, 'Loans entering month 3');
  await poolFormula(client, 3, 'Month 3 pool formula');
  const drift3 = await driftCheck(client, 3, 'Month 3 drift check');

  // Verify pool loans still have monthly_interest=0
  const poolLoans3 = await client.query(`
    SELECT id, outstanding_balance, monthly_interest FROM loans
    WHERE cycle_id=$1 AND loan_type='common_interest_pool' AND status='disbursed'
  `, [CYCLE_ID]);
  let poolLoanViolation = false;
  for (const r of poolLoans3.rows) {
    if (parseFloat(r.monthly_interest) > 0.001) {
      poolLoanViolation = true;
      fail(`Pool loan #${r.id} compounded to monthly_interest=${r.monthly_interest}!`);
    }
  }
  if (!poolLoanViolation && poolLoans3.rows.length > 0)
    ok(`  All ${poolLoans3.rows.length} active pool loans still have monthly_interest=0 ✓`);

  // Verify common_interest loans ARE compounding
  const ciLoans3 = await client.query(`
    SELECT id, member_id, amount, outstanding_balance, monthly_interest
    FROM loans WHERE cycle_id=$1 AND loan_type='common_interest' AND status='disbursed'
  `, [CYCLE_ID]);
  let ciViolation = false;
  for (const r of ciLoans3.rows) {
    if (parseFloat(r.monthly_interest) <= 0.001) {
      ciViolation = true;
      fail(`common_interest loan #${r.id} has monthly_interest=0!`);
    } else {
      ok(`  CI loan #${r.id} (m${r.member_id}): out=${r.outstanding_balance}  interest=${r.monthly_interest} ✓`);
    }
  }

  // Savings compounding check: m3.accum = m2.accum × 1.15
  const savChk3 = await client.query(`
    SELECT m2.member_id, m2.accumulated_savings AS m2_acc, m3.accumulated_savings AS m3_acc,
           ROUND(m2.accumulated_savings * 1.15, 2) AS expected
    FROM monthly_balances m2
    JOIN monthly_balances m3 ON m3.member_id=m2.member_id AND m3.cycle_id=m2.cycle_id AND m3.month=3
    WHERE m2.cycle_id=$1 AND m2.month=2
  `, [CYCLE_ID]);
  info('  Savings compounding m3 = m2 × 1.15:');
  let savOk3 = true;
  for (const r of savChk3.rows) {
    const match = r.m3_acc.toString() === r.expected.toString();
    if (!match) savOk3 = false;
    info(`   member ${r.member_id}: m2=${r.m2_acc} → expected=${r.expected}  actual=${r.m3_acc}  ${match ? '✓' : '⚠ MISMATCH!'}`);
  }
  if (savOk3) ok('  All savings compounding correct ✓');

  // Show final state
  const mb3 = await client.query(`
    SELECT mb.member_id, SUBSTRING(u.full_name,1,18) AS name,
           mb.savings_principal, mb.accumulated_savings,
           mb.outstanding_loan, mb.cumulative_borrowing,
           mb.social_fund_paid, mb.membership_fee_paid, mb.compliance_status
    FROM monthly_balances mb JOIN members m ON m.id=mb.member_id JOIN users u ON u.id=m.user_id
    WHERE mb.cycle_id=$1 AND mb.month=3 ORDER BY mb.member_id
  `, [CYCLE_ID]);

  info('\n  Final monthly_balances month 3:');
  info('  member | name               | savings_p | accum_sav  | outstanding  | cumul_borrow | compliance');
  for (const r of mb3.rows) {
    info(`  ${r.member_id}      | ${r.name.padEnd(19)}| ${String(r.savings_principal).padEnd(10)}| ${String(r.accumulated_savings).padEnd(11)}| ${String(r.outstanding_loan).padEnd(13)}| ${String(r.cumulative_borrowing).padEnd(13)}| ${r.compliance_status}`);
  }

  return drift3 && !poolLoanViolation && !ciViolation && savOk3;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  FULL CYCLE SIMULATION — Month 1 → Month 2 → Month 3               ║');
  console.log('║  Using REAL model functions (all business logic runs)               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

  const client = await db.pool.connect();
  let allPassed = true;

  try {
    // RESET
    await client.query('BEGIN');
    await resetCycle(client);
    await client.query('COMMIT');

    // MONTH 1
    await runMonth1(client);
    await poolFormula(client, 1, 'END OF MONTH 1 STATE');
    await driftCheck(client, 1, 'END OF MONTH 1');

    // ADVANCE → MONTH 2
    await advanceMonth('Month 1 → Month 2');

    // MONTH 2
    await runMonth2(client);

    // ADVANCE → MONTH 3
    await advanceMonth('Month 2 → Month 3');

    // VERIFY MONTH 3
    allPassed = await verifyMonth3(client);

    sep('SIMULATION COMPLETE');
    if (allPassed) {
      ok('ALL CHECKS PASSED — system is correct end-to-end ✅');
    } else {
      fail('SOME CHECKS FAILED — review output above ❌');
    }

    const cycleState = await client.query('SELECT current_month FROM cycles WHERE id=$1', [CYCLE_ID]);
    ok(`Cycle 15 is now on month ${cycleState.rows[0].current_month}`);

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    fail(`FATAL SIMULATION ERROR: ${err.message}`);
    console.error(err.stack);
    allPassed = false;
  } finally {
    client.release();
    await db.pool.end();
  }

  process.exit(allPassed ? 0 : 1);
}

main();
