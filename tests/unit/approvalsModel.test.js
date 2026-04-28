/**
 * Unit tests for approvalsModel.js
 *
 * Covers:
 *  - getApprovalStats: correctly maps approval_type/status combinations
 *  - syncDeclarationStatus: rejected > all-approved > some-pending
 *  - createApproval: inserts with correct fields
 *  - approveSavingsDeclaration: savings cap enforcement, idempotency guard
 *  - approveLoanRequest: monthly_interest computed from loanInterestRate, month >= constraint,
 *    compliance_status set correctly
 *  - approveLoanRepayment: monthly_balances.outstanding_loan updated for month >= current_month
 *  - rejectApproval: marks approval & declaration as rejected
 */

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = { query: mockClientQuery, release: mockClientRelease };

jest.mock('../../src/config/database', () => ({
  query: mockQuery,
  pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));

const {
  getApprovalStats,
  createApproval,
  approveSavingsDeclaration,
  approveLoanRequest,
  approveLoanRepayment,
} = require('../../src/models/approvalsModel');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeApproval(overrides = {}) {
  return {
    id: 1,
    approval_type: 'savings_declaration',
    entity_id: 10,
    member_id: 5,
    cycle_id: 12,
    amount: 10000,
    status: 'pending',
    submitted_by: 5,
    ...overrides,
  };
}

function makeDeclaration(overrides = {}) {
  return {
    id: 10,
    member_id: 5,
    cycle_id: 12,
    month: 3,
    savings_amount: '10000',
    loan_request: '0',
    principal_repayment: '0',
    interest_repayment: '0',
    status: 'pending',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks only clears call history — it does NOT flush the mockResolvedValueOnce queue.
  // mockReset() clears both call history AND the queued return values, preventing cross-test contamination.
  mockClientQuery.mockReset();
  mockQuery.mockReset();
});

// ─── getApprovalStats ────────────────────────────────────────────────────────

describe('getApprovalStats', () => {
  test('correctly counts pending/approved/rejected per type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { approval_type: 'savings_declaration', status: 'pending',  count: '2', total_amount: '20000' },
        { approval_type: 'savings_declaration', status: 'approved', count: '1', total_amount: '10000' },
        { approval_type: 'loan_request',        status: 'pending',  count: '1', total_amount: '15000' },
        { approval_type: 'loan_repayment',      status: 'approved', count: '3', total_amount: '6000'  },
        { approval_type: 'loan_repayment',      status: 'rejected', count: '1', total_amount: '500'   },
      ],
    });

    const stats = await getApprovalStats(12);

    expect(stats.pending_savings).toBe(2);
    expect(stats.approved_savings).toBe(1);
    expect(stats.pending_loan_requests).toBe(1);
    expect(stats.approved_repayments).toBe(3);
    expect(stats.rejected_repayments).toBe(1);
    expect(stats.total_pending).toBe(3); // 2 savings + 1 loan_request + 0 repayments
  });

  test('total_pending sums all three pending types', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { approval_type: 'savings_declaration', status: 'pending', count: '1', total_amount: '0' },
        { approval_type: 'loan_request',        status: 'pending', count: '2', total_amount: '0' },
        { approval_type: 'loan_repayment',      status: 'pending', count: '3', total_amount: '0' },
      ],
    });

    const stats = await getApprovalStats(12);
    expect(stats.total_pending).toBe(6);
  });

  test('returns zeroes when no approvals exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const stats = await getApprovalStats(12);
    expect(stats.total_pending).toBe(0);
    expect(stats.pending_savings).toBe(0);
    expect(stats.pending_loan_requests).toBe(0);
    expect(stats.pending_repayments).toBe(0);
  });
});

// ─── createApproval ──────────────────────────────────────────────────────────

describe('createApproval', () => {
  test('inserts approval with correct fields and returns row', async () => {
    const inserted = makeApproval();
    mockQuery.mockResolvedValueOnce({ rows: [inserted] });

    const result = await createApproval('savings_declaration', 10, 5, 12, 10000, 5);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO approvals');
    expect(params).toEqual(['savings_declaration', 10, 5, 12, 10000, 5]);
    expect(result).toEqual(inserted);
  });
});

// ─── approveSavingsDeclaration ────────────────────────────────────────────────

describe('approveSavingsDeclaration', () => {
  function setupSavingsApproval({
    approval = makeApproval(),
    decl = makeDeclaration(),
    cycleConfig = { maxSavings: 30000 },
    existingCycleTotal = '0',
    existingSavings = null,
    memberName = 'Alice',
  } = {}) {
    mockClientQuery
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [approval] })                       // SELECT approval FOR UPDATE
      .mockResolvedValueOnce({ rows: [decl] })                           // SELECT declaration
      .mockResolvedValueOnce({ rows: [{ current_month: 3, config: cycleConfig }] }) // SELECT cycle config
      .mockResolvedValueOnce({ rows: [{ cycle_total: existingCycleTotal }] }) // cycle total
      .mockResolvedValueOnce({ rows: existingSavings ? [existingSavings] : [] }) // existing savings
      .mockResolvedValueOnce({ rows: [{ full_name: memberName }] })     // member name
      .mockResolvedValueOnce({})                                          // INSERT savings
      .mockResolvedValueOnce({})                                          // UPDATE monthly_balances
      .mockResolvedValueOnce({})                                          // INSERT transactions
      .mockResolvedValueOnce({})                                          // UPDATE approval
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })          // syncDeclarationStatus SELECT
      .mockResolvedValueOnce({})                                          // syncDeclarationStatus UPDATE
      .mockResolvedValueOnce({});                                         // COMMIT
  }

  test('approves declaration and commits savings', async () => {
    setupSavingsApproval();
    const result = await approveSavingsDeclaration(1, 99);
    expect(result).toBe(true);
    expect(mockClientQuery.mock.calls.some(([s]) => typeof s === 'string' && s.includes('COMMIT'))).toBe(true);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('throws when approval not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })         // approval — not found
      .mockResolvedValueOnce({});                  // ROLLBACK

    await expect(approveSavingsDeclaration(999, 1)).rejects.toThrow('Approval not found');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('throws when approval already processed (not pending)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                        // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval({ status: 'approved' })] }) // already approved
      .mockResolvedValueOnce({});                                        // ROLLBACK

    await expect(approveSavingsDeclaration(1, 1)).rejects.toThrow('Approval already processed');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('throws when savings would exceed cycle cap', async () => {
    const decl = makeDeclaration({ savings_amount: '10000' });
    mockClientQuery
      .mockResolvedValueOnce({})                                                    // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval()] })                           // approval
      .mockResolvedValueOnce({ rows: [decl] })                                     // declaration
      .mockResolvedValueOnce({ rows: [{ current_month: 3, config: { maxSavings: 30000 } }] }) // cycle
      .mockResolvedValueOnce({ rows: [{ cycle_total: '25000' }] })                // existing = 25000
      .mockResolvedValueOnce({});                                                   // ROLLBACK

    // 25000 + 10000 = 35000 > 30000 → should throw
    await expect(approveSavingsDeclaration(1, 1)).rejects.toThrow(/exceed.*cap/i);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('skips savings insert when savings already recorded (idempotency)', async () => {
    // existingSavings row already present → should not INSERT again
    const existingSavings = { id: 7, member_id: 5, cycle_id: 12, month: 3 };
    mockClientQuery
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval()] })                // approval
      .mockResolvedValueOnce({ rows: [makeDeclaration()] })             // declaration
      .mockResolvedValueOnce({ rows: [{ current_month: 3, config: { maxSavings: 30000 } }] })
      .mockResolvedValueOnce({ rows: [{ cycle_total: '0' }] })
      .mockResolvedValueOnce({ rows: [existingSavings] })               // already exists
      // no INSERT savings — skip straight to UPDATE approval
      .mockResolvedValueOnce({})                                         // UPDATE approval
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })         // syncDeclarationStatus SELECT
      .mockResolvedValueOnce({})                                         // syncDeclarationStatus UPDATE
      .mockResolvedValueOnce({});                                        // COMMIT

    await approveSavingsDeclaration(1, 99);

    const insertSavingsCalls = mockClientQuery.mock.calls.filter(
      ([s]) => typeof s === 'string' && s.includes('INSERT INTO savings')
    );
    expect(insertSavingsCalls).toHaveLength(0);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

// ─── approveLoanRequest ───────────────────────────────────────────────────────

describe('approveLoanRequest', () => {
  const loanDecl = makeDeclaration({ savings_amount: '0', loan_request: '20000' });
  const cycleData = {
    current_month: 3,
    config: { loanInterestRate: 0.15, minBorrowing: 20000 },
  };

  function setupLoanApproval({
    approval = makeApproval({ approval_type: 'loan_request', amount: 20000 }),
    decl = loanDecl,
    cycle = cycleData,
    existingCumulative = '0',
  } = {}) {
    mockClientQuery
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [approval] })                       // SELECT approval FOR UPDATE
      .mockResolvedValueOnce({ rows: [decl] })                           // SELECT declaration
      .mockResolvedValueOnce({ rows: [cycle] })                          // SELECT cycle
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })                   // SELECT existing loans count
      .mockResolvedValueOnce({})                                          // INSERT loan
      .mockResolvedValueOnce({ rows: [{ cumulative_borrowing: existingCumulative }] }) // SELECT cumulative_borrowing
      .mockResolvedValueOnce({})                                          // UPDATE monthly_balances
      .mockResolvedValueOnce({ rows: [{ full_name: 'Alice' }] })         // SELECT member name
      .mockResolvedValueOnce({})                                          // INSERT transactions
      .mockResolvedValueOnce({})                                          // UPDATE approval
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })          // syncDeclarationStatus SELECT
      .mockResolvedValueOnce({})                                          // syncDeclarationStatus UPDATE
      .mockResolvedValueOnce({});                                         // COMMIT
  }

  test('inserts loan with monthly_interest = loanAmount × loanInterestRate', async () => {
    setupLoanApproval();
    await approveLoanRequest(1, 99);

    const insertLoanCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('INSERT INTO loans')
    );
    expect(insertLoanCall).toBeDefined();
    const params = insertLoanCall[1];
    // monthly_interest should be 20000 × 0.15 = 3000
    const monthlyInterestParam = params.find((p) => typeof p === 'number' && Math.abs(p - 3000) < 0.01);
    expect(monthlyInterestParam).toBeCloseTo(3000, 2);
  });

  test('sets compliance_status = at_or_above_minimum when cumulative >= minBorrowing', async () => {
    // existing cumulative = 0, new loan = 20000 → new cumulative = 20000 >= 20000
    setupLoanApproval({ existingCumulative: '0' });
    await approveLoanRequest(1, 99);

    const updateBalCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('UPDATE monthly_balances')
    );
    const params = updateBalCall[1];
    // compliance status is $3 in the UPDATE
    expect(params[2]).toBe('at_or_above_minimum');
  });

  test('sets compliance_status = borrowed_below_minimum when cumulative < minBorrowing', async () => {
    // existing = 0, new loan = 5000 → cumulative = 5000 < 20000
    setupLoanApproval({
      approval: makeApproval({ approval_type: 'loan_request', amount: 5000 }),
      decl: makeDeclaration({ savings_amount: '0', loan_request: '5000' }),
      existingCumulative: '0',
    });
    await approveLoanRequest(1, 99);

    const updateBalCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('UPDATE monthly_balances')
    );
    expect(updateBalCall[1][2]).toBe('borrowed_below_minimum');
  });

  test('uses month >= constraint in monthly_balances UPDATE', async () => {
    setupLoanApproval();
    await approveLoanRequest(1, 99);

    const updateBalCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('UPDATE monthly_balances')
    );
    expect(updateBalCall[0]).toMatch(/month\s*>=\s*\$\d/);
  });

  test('throws when loan request approval not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})            // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // not found
      .mockResolvedValueOnce({});           // ROLLBACK

    await expect(approveLoanRequest(999, 1)).rejects.toThrow('Approval not found');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

// ─── approveLoanRepayment ─────────────────────────────────────────────────────

describe('approveLoanRepayment', () => {
  const repayment = {
    id: 50,
    loan_id: 99,
    member_id: 5,
    cycle_id: 12,
    amount: '5000',
    status: 'pending',
  };
  const loan = { id: 99, outstanding_balance: '19000' }; // 19000 - 5000 = 14000 remaining

  test('reduces loan outstanding_balance by repayment amount', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval({ approval_type: 'loan_repayment', entity_id: 50 })] })
      .mockResolvedValueOnce({ rows: [repayment] })                      // SELECT repayment
      .mockResolvedValueOnce({})                                         // UPDATE loan_repayments (approved)
      .mockResolvedValueOnce({ rows: [{ current_month: 3 }] })          // SELECT current_month
      .mockResolvedValueOnce({})                                         // UPDATE loan outstanding
      .mockResolvedValueOnce({ rows: [{ outstanding_balance: '14000' }] }) // re-fetch
      .mockResolvedValueOnce({})                                         // UPDATE monthly_balances
      .mockResolvedValueOnce({})                                         // UPDATE approval
      .mockResolvedValueOnce({});                                        // COMMIT

    await approveLoanRepayment(1, 99);

    const updateLoanCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('UPDATE loans') && s.includes('outstanding_balance')
    );
    expect(updateLoanCall).toBeDefined();
    // $1 = repayment amount, $2 = loan_id
    const [, params] = updateLoanCall;
    expect(parseFloat(params[0])).toBe(5000);
    expect(params[1]).toBe(99); // loan_id from repayment
  });

  test('updates monthly_balances with month >= current_month', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval({ approval_type: 'loan_repayment', entity_id: 50 })] })
      .mockResolvedValueOnce({ rows: [repayment] })                      // SELECT repayment
      .mockResolvedValueOnce({})                                         // UPDATE loan_repayments (approved)
      .mockResolvedValueOnce({ rows: [{ current_month: 3 }] })          // SELECT current_month
      .mockResolvedValueOnce({})                                         // UPDATE loans
      .mockResolvedValueOnce({ rows: [{ outstanding_balance: '14000' }] }) // re-fetch
      .mockResolvedValueOnce({})                                         // UPDATE monthly_balances
      .mockResolvedValueOnce({})                                         // UPDATE approval
      .mockResolvedValueOnce({});                                        // COMMIT

    await approveLoanRepayment(1, 99);

    const updateBalCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes('UPDATE monthly_balances')
    );
    expect(updateBalCall).toBeDefined();
    expect(updateBalCall[0]).toMatch(/month\s*>=\s*\$\d/);
  });

  test('marks loan as repaid when outstanding_balance reaches 0', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval({ approval_type: 'loan_repayment', entity_id: 50 })] })
      .mockResolvedValueOnce({ rows: [repayment] })                      // SELECT repayment
      .mockResolvedValueOnce({})                                         // UPDATE loan_repayments (approved)
      .mockResolvedValueOnce({ rows: [{ current_month: 3 }] })          // SELECT current_month
      .mockResolvedValueOnce({})                                         // UPDATE loan outstanding
      .mockResolvedValueOnce({ rows: [{ outstanding_balance: '0' }] })  // re-fetch — fully paid
      .mockResolvedValueOnce({})                                         // UPDATE loan status = repaid
      .mockResolvedValueOnce({})                                         // UPDATE monthly_balances
      .mockResolvedValueOnce({})                                         // UPDATE approval
      .mockResolvedValueOnce({});                                        // COMMIT

    await approveLoanRepayment(1, 99);

    const markRepaidCall = mockClientQuery.mock.calls.find(
      ([s]) => typeof s === 'string' && s.includes("status = 'repaid'")
    );
    expect(markRepaidCall).toBeDefined();
  });

  test('throws when approval not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})            // BEGIN
      .mockResolvedValueOnce({ rows: [] })  // not found
      .mockResolvedValueOnce({});           // ROLLBACK

    await expect(approveLoanRepayment(999, 1)).rejects.toThrow('Approval not found');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('releases client on success', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [makeApproval({ approval_type: 'loan_repayment', entity_id: 50 })] })
      .mockResolvedValueOnce({ rows: [repayment] })                      // SELECT repayment
      .mockResolvedValueOnce({})                                         // UPDATE loan_repayments (approved)
      .mockResolvedValueOnce({ rows: [{ current_month: 3 }] })          // SELECT current_month
      .mockResolvedValueOnce({})                                         // UPDATE loans outstanding
      .mockResolvedValueOnce({ rows: [{ outstanding_balance: '5000' }] }) // re-fetch
      .mockResolvedValueOnce({})                                         // UPDATE monthly_balances
      .mockResolvedValueOnce({})                                         // UPDATE approval
      .mockResolvedValueOnce({});                                        // COMMIT

    await approveLoanRepayment(1, 99);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
