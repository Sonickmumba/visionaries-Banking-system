/**
 * Unit tests for processMonthEnd & getMonthEndSummary (monthlyProcessingsModel.js)
 *
 * Covers:
 *  - savings interest compounding
 *  - loan interest compounding (outstanding_balance + monthly_interest updated)
 *  - compliance_status carried forward to next month
 *  - totalNewOutstanding is 0 when no active loans (not stale carry-over)
 *  - cycle current_month incremented
 *  - rejects beyond cycle end date
 *  - cycle not found throws
 *  - config key fallbacks for interestRate
 */

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = { query: mockClientQuery, release: mockClientRelease };

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn(() => Promise.resolve(mockClient)) },
}));

const { processMonthEnd, getMonthEndSummary } = require('../../src/models/monthlyProcessingsModel');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Collects only non-transaction queries (strips BEGIN/COMMIT/ROLLBACK/SET) */
function dataQueries(calls) {
  const txKeywords = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SET '];
  return calls.filter(([sql]) => typeof sql === 'string' && !txKeywords.some((k) => sql.trimStart().startsWith(k)));
}

function makeCycle(overrides = {}) {
  return {
    id: 12,
    name: 'Cycle 2026',
    start_date: '2026-01-01',
    end_date: '2026-06-30',   // 6-month cycle → max month = 6
    current_month: 2,
    status: 'active',
    config: { commonInterestRate: 0.15, loanInterestRate: 0.15 },
    ...overrides,
  };
}

function makeBalance(overrides = {}) {
  return {
    savings_principal: 10000,
    accumulated_savings: 10000,
    outstanding_loan: 0,
    cumulative_borrowing: 0,
    common_interest_due: 0,
    penalties_due: 0,
    social_fund_paid: true,
    membership_fee_paid: true,
    compliance_status: 'never_borrowed',
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe('processMonthEnd — happy path (no active loans)', () => {
  beforeEach(() => {
    mockClientQuery
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [makeCycle()] })                    // SELECT cycle
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })          // SELECT members (2)
      // member 1
      .mockResolvedValueOnce({ rows: [makeBalance({ accumulated_savings: 10000 })] }) // monthly_balances
      .mockResolvedValueOnce({ rows: [] })                               // active loans — none
      .mockResolvedValueOnce({})                                          // INSERT monthly_balances
      .mockResolvedValueOnce({})                                          // UPDATE savings
      .mockResolvedValueOnce({})                                          // INSERT transactions (savings interest)
      // member 2
      .mockResolvedValueOnce({ rows: [makeBalance({ accumulated_savings: 15000 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      // advance cycle
      .mockResolvedValueOnce({})                                          // UPDATE cycles
      .mockResolvedValueOnce({});                                         // COMMIT
  });

  test('returns correct cycle progress metadata', async () => {
    const result = await processMonthEnd(12);
    expect(result.previousMonth).toBe(2);
    expect(result.newMonth).toBe(3);
    expect(result.membersProcessed).toBe(2);
    expect(result.cycleId).toBe(12);
    expect(result.interestRate).toBe(0.15);
  });

  test('passes outstanding_loan = 0 (not stale balance) when no loans', async () => {
    await processMonthEnd(12);
    const calls = mockClientQuery.mock.calls;
    // Find INSERT monthly_balances for member 1 (first one)
    const insertCall = calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO monthly_balances')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    // $6 = outstanding_loan (index 5, 0-based: memberId, cycleId, month, savings_principal, accumulated_savings, outstanding_loan …)
    expect(params[5]).toBe(0); // totalNewOutstanding = 0 when no active loans
  });

  test('releases client on success', async () => {
    await processMonthEnd(12);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

describe('processMonthEnd — with active loan', () => {
  const balance = makeBalance({
    accumulated_savings: 10000,
    outstanding_loan: 20000,
    cumulative_borrowing: 20000,
    compliance_status: 'at_or_above_minimum',
  });

  const loan = {
    id: 99,
    outstanding_balance: '20000',
    monthly_interest: '3000',      // 15% of 20000
  };

  beforeEach(() => {
    mockClientQuery
      .mockResolvedValueOnce({})                           // BEGIN
      .mockResolvedValueOnce({ rows: [makeCycle()] })     // SELECT cycle
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })       // SELECT members
      // member 1
      .mockResolvedValueOnce({ rows: [balance] })          // monthly_balances
      .mockResolvedValueOnce({ rows: [loan] })             // active loans
      .mockResolvedValueOnce({})                           // UPDATE loan
      .mockResolvedValueOnce({})                           // INSERT monthly_balances
      .mockResolvedValueOnce({})                           // UPDATE savings
      .mockResolvedValueOnce({})                           // INSERT tx savings interest
      .mockResolvedValueOnce({})                           // INSERT tx loan interest
      // advance
      .mockResolvedValueOnce({})                           // UPDATE cycles
      .mockResolvedValueOnce({});                          // COMMIT
  });

  test('compounds loan: new outstanding = balance + interest', async () => {
    await processMonthEnd(12);

    const updateLoanCall = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE loans')
    );
    expect(updateLoanCall).toBeDefined();
    const params = updateLoanCall[1];
    // $1 = new outstanding = 20000 + 3000 = 23000
    expect(params[0]).toBe(23000);
    // $2 = new monthly_interest = 23000 * 0.15 = 3450
    expect(params[1]).toBeCloseTo(3450, 2);
    // $3 = loan id
    expect(params[2]).toBe(99);
  });

  test('passes compounded outstanding_loan into next-month balance INSERT', async () => {
    await processMonthEnd(12);

    const insertCall = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO monthly_balances')
    );
    const params = insertCall[1];
    // $6 = outstanding_loan (index 5) = 23000
    expect(params[5]).toBe(23000);
  });

  test('carries compliance_status forward', async () => {
    await processMonthEnd(12);

    const insertCall = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO monthly_balances')
    );
    const params = insertCall[1];
    // $12 = compliance_status (index 11)
    expect(params[11]).toBe('at_or_above_minimum');
  });
});

describe('processMonthEnd — config key fallbacks', () => {
  function setupWithConfig(config, members = 0) {
    mockClientQuery
      .mockResolvedValueOnce({})                                                     // BEGIN
      .mockResolvedValueOnce({ rows: [makeCycle({ config })] })                    // SELECT cycle
      .mockResolvedValueOnce({ rows: Array.from({ length: members }, (_, i) => ({ id: i + 1 })) }) // members
      .mockResolvedValueOnce({})                                                     // UPDATE cycles
      .mockResolvedValueOnce({});                                                    // COMMIT
  }

  test('uses commonInterestRate when interestRate absent', async () => {
    setupWithConfig({ commonInterestRate: 0.12 });
    const result = await processMonthEnd(12);
    expect(result.interestRate).toBe(0.12);
  });

  test('uses savingsInterestRate as last resort', async () => {
    setupWithConfig({ savingsInterestRate: 0.10 });
    const result = await processMonthEnd(12);
    expect(result.interestRate).toBe(0.10);
  });

  test('defaults to 0.15 when no rate key exists', async () => {
    setupWithConfig({});
    const result = await processMonthEnd(12);
    expect(result.interestRate).toBe(0.15);
  });
});

describe('processMonthEnd — boundary / error cases', () => {
  test('throws when cycle not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})               // BEGIN
      .mockResolvedValueOnce({ rows: [] })     // cycle — empty
      .mockResolvedValueOnce({});              // ROLLBACK (cleanup)

    await expect(processMonthEnd(999)).rejects.toThrow('Cycle not found');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('throws when advancing beyond cycle end date', async () => {
    // start_date 2026-01-01, end_date 2026-01-31 → 1 month; current_month = 1 → nextMonth = 2 > 1
    const shortCycle = makeCycle({ start_date: '2026-01-01', end_date: '2026-01-31', current_month: 1 });
    mockClientQuery
      .mockResolvedValueOnce({})                          // BEGIN
      .mockResolvedValueOnce({ rows: [shortCycle] })     // cycle
      .mockResolvedValueOnce({});                         // ROLLBACK

    await expect(processMonthEnd(12)).rejects.toThrow('Cannot advance beyond cycle end date');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('releases client even when DB query throws mid-flight', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                      // BEGIN
      .mockResolvedValueOnce({ rows: [makeCycle()] }) // cycle
      .mockRejectedValueOnce(new Error('DB crash'));  // SELECT members fails

    await expect(processMonthEnd(12)).rejects.toThrow('DB crash');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

describe('getMonthEndSummary', () => {
  const cycle = makeCycle();
  const summary = {
    total_members: '3',
    total_principal: '30000',
    total_accumulated_savings: '34500',
    total_outstanding_loans: '46287.5',
    total_cumulative_borrowing: '35000',
    total_common_interest_due: '0',
    total_penalties_due: '0',
  };
  const declStats = { total_declarations: '3', processed_declarations: '2', pending_declarations: '1' };
  const missingStats = { missing_count: '0' };

  function setupSummaryMocks() {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [cycle] })         // SELECT cycle
      .mockResolvedValueOnce({ rows: [summary] })       // aggregate
      .mockResolvedValueOnce({ rows: [declStats] })     // declarations
      .mockResolvedValueOnce({ rows: [missingStats] }); // missing
  }

  test('returns expected top-level keys', async () => {
    setupSummaryMocks();
    const data = await getMonthEndSummary(12, 2);
    // getMonthEndSummary returns a flat object
    expect(data).toHaveProperty('cycleId');
    expect(data).toHaveProperty('cycleName');
    expect(data).toHaveProperty('declarations');
    expect(data).toHaveProperty('totalAccumulatedSavings');
    expect(data).toHaveProperty('savingsInterestToApply');
  });

  test('computes savingsInterestToApply = accumulated × interestRate', async () => {
    setupSummaryMocks();
    const data = await getMonthEndSummary(12, 2);
    // 34500 * 0.15 = 5175
    expect(data.savingsInterestToApply).toBeCloseTo(5175, 2);
  });

  test('reports correct month metadata', async () => {
    setupSummaryMocks();
    const data = await getMonthEndSummary(12, 2);
    expect(data.currentMonth).toBe(2);
    expect(data.nextMonth).toBe(3);
    expect(data.cycleId).toBe(12);
    expect(data.interestRate).toBe(0.15);
  });

  test('throws when cycle not found', async () => {
    // mockReset clears both call history AND the return-value queue
    mockClientQuery.mockReset();
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getMonthEndSummary(999, 1)).rejects.toThrow('Cycle not found');
  });
});
