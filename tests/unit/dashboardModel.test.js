/**
 * Unit tests for getDashboardData (dashboardModel.js)
 *
 * All DB calls are mocked via a fake pg client. Tests verify:
 *  - correct unborrowed pool formula (cash-flow based)
 *  - missing declaration count (Math.max guard)
 *  - cycle-not-found throws 404
 *  - month resolution fallback to cycle.current_month
 *  - config key fallbacks (commonInterestRate, minBorrowing, etc.)
 */

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn(() => Promise.resolve(mockClient)),
  },
}));

const { getDashboardData } = require('../../src/models/dashboardModel');

// ─── helpers ────────────────────────────────────────────────────────────────

const makeCycle = (overrides = {}) => ({
  id: 12,
  name: 'Cycle 2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  current_month: 3,
  status: 'active',
  member_count: 3,
  config: {
    commonInterestRate: 0.15,
    socialFund: 1000,
    membershipFee: 500,
    minBorrowing: 20000,
    loanInterestRate: 0.15,
  },
  ...overrides,
});

const makeStats = (overrides = {}) => ({
  total_members: '3',
  total_savings_principal: '35000',
  total_accumulated_savings: '40250',
  total_outstanding_loans: '46287.5',
  total_cumulative_borrowing: '35000',
  total_common_interest_due: '0',
  total_penalties_due: '0',
  social_fund_paid_count: '3',
  membership_fee_paid_count: '3',
  ...overrides,
});

/** Build the full sequence of mockClientQuery return values for a happy-path call */
function setupHappyPath({
  cycle = makeCycle(),
  stats = makeStats(),
  activeMembers = '3',
  penalties = '0',
  totalDisbursed = '35000',
  totalRepaid = '0',
  balances = [],
  declCounts = { submitted: '2', processed: '1', pending: '0' },
  loans = [],
  recentDecls = [],
} = {}) {
  // Call order (sequential awaits + one Promise.all of 4):
  // 0  SET TRANSACTION
  // 1  BEGIN READ ONLY
  // 2  SELECT cycle
  // 3  stats (Promise.all[0])
  // 4  active members (Promise.all[1])
  // 5  penalties (Promise.all[2])
  // 6  loan cash (Promise.all[3])
  // 7  monthly_balances per member
  // 8  declaration counts
  // 9  recent loans
  // 10 recent declarations
  // 11 COMMIT

  mockClientQuery
    .mockResolvedValueOnce({})                                            // 0 SET TRANSACTION
    .mockResolvedValueOnce({})                                            // 1 BEGIN READ ONLY
    .mockResolvedValueOnce({ rows: [cycle] })                            // 2 cycle
    .mockResolvedValueOnce({ rows: [stats] })                            // 3 stats
    .mockResolvedValueOnce({ rows: [{ active_members: activeMembers }] }) // 4 active members
    .mockResolvedValueOnce({ rows: [{ total_unpaid_penalties: penalties }] }) // 5 penalties
    .mockResolvedValueOnce({                                              // 6 loan cash
      rows: [{
        total_disbursed_principal: totalDisbursed,
        total_repaid_principal: totalRepaid,
      }],
    })
    .mockResolvedValueOnce({ rows: balances })                           // 7 balances
    .mockResolvedValueOnce({                                             // 8 decl counts
      rows: [declCounts],
    })
    .mockResolvedValueOnce({ rows: loans })                              // 9 recent loans
    .mockResolvedValueOnce({ rows: recentDecls })                        // 10 recent decls
    .mockResolvedValueOnce({});                                          // 11 COMMIT
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getDashboardData — unborrowed pool', () => {
  test('is 0 when all savings are lent out and no repayments yet', async () => {
    setupHappyPath({
      stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0', total_savings_principal: '35000' }),
      totalDisbursed: '35000',
      totalRepaid: '0',
    });

    const data = await getDashboardData(12, 3);
    expect(data.stats.unborrowed).toBe(0);
    expect(data.stats.netCashLentOut).toBe(35000);
  });

  test('increases correctly when a principal repayment arrives', async () => {
    setupHappyPath({
      stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0', total_savings_principal: '35000' }),
      totalDisbursed: '35000',
      totalRepaid: '5000',
    });

    const data = await getDashboardData(12, 3);
    expect(data.stats.totalRepaidPrincipal).toBe(5000);
    expect(data.stats.netCashLentOut).toBe(30000);
    expect(data.stats.unborrowed).toBe(5000);
  });

  test('includes socialFund and membershipFee in pool', async () => {
    // 3 members × 1000 socialFund + 3 × 500 membershipFee = 4500 extra in pool
    setupHappyPath({
      stats: makeStats({
        total_savings_principal: '35000',
        social_fund_paid_count: '3',
        membership_fee_paid_count: '3',
      }),
      totalDisbursed: '35000',
      totalRepaid: '0',
    });

    const data = await getDashboardData(12, 3);
    // pool = 35000 + 3000 + 1500 = 39500; net lent = 35000 → unborrowed = 4500
    expect(data.stats.pool).toBe(39500);
    expect(data.stats.unborrowed).toBe(4500);
  });

  test('never returns a negative unborrowed amount (Math.max guard)', async () => {
    // Edge case: somehow disbursed > pool (should not happen but guard must hold)
    setupHappyPath({
      stats: makeStats({
        total_savings_principal: '10000',
        social_fund_paid_count: '0',
        membership_fee_paid_count: '0',
      }),
      totalDisbursed: '20000',
      totalRepaid: '0',
    });

    const data = await getDashboardData(12, 3);
    expect(data.stats.unborrowed).toBe(0);
    expect(data.stats.unborrowed).toBeGreaterThanOrEqual(0);
  });

  test('unborrowed equals pool when nothing has been disbursed', async () => {
    setupHappyPath({
      stats: makeStats({
        total_savings_principal: '30000',
        social_fund_paid_count: '0',
        membership_fee_paid_count: '0',
      }),
      totalDisbursed: '0',
      totalRepaid: '0',
    });

    const data = await getDashboardData(12, 3);
    expect(data.stats.pool).toBe(30000);
    expect(data.stats.unborrowed).toBe(30000);
  });
});

describe('getDashboardData — config key fallbacks', () => {
  test('uses commonInterestRate when interestRate is absent', async () => {
    const cycle = makeCycle({ config: { commonInterestRate: 0.12, socialFund: 0, membershipFee: 0 } });
    setupHappyPath({ cycle, stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0' }) });

    const data = await getDashboardData(12, 3);
    expect(data.stats.interestRate).toBe(0.12);
    expect(data.cycle.interestRate).toBe(0.12);
  });

  test('uses savingsInterestRate as last-resort fallback', async () => {
    const cycle = makeCycle({ config: { savingsInterestRate: 0.10, socialFund: 0, membershipFee: 0 } });
    setupHappyPath({ cycle, stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0' }) });

    const data = await getDashboardData(12, 3);
    expect(data.stats.interestRate).toBe(0.10);
  });

  test('defaults interestRate to 0.15 when no rate config key exists', async () => {
    const cycle = makeCycle({ config: { socialFund: 0, membershipFee: 0 } });
    setupHappyPath({ cycle, stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0' }) });

    const data = await getDashboardData(12, 3);
    expect(data.stats.interestRate).toBe(0.15);
  });

  test('uses minBorrowing when minimumBorrowingAmount is absent', async () => {
    const cycle = makeCycle({ config: { commonInterestRate: 0.15, minBorrowing: 25000, socialFund: 0, membershipFee: 0 } });
    setupHappyPath({ cycle, stats: makeStats({ social_fund_paid_count: '0', membership_fee_paid_count: '0' }) });

    const data = await getDashboardData(12, 3);
    expect(data.cycle.minimumBorrowingAmount).toBe(25000);
  });

  test('uses socialFundAmount fallback when socialFund is absent', async () => {
    const cycle = makeCycle({ config: { commonInterestRate: 0.15, socialFundAmount: 2000, membershipFee: 0 } });
    setupHappyPath({
      cycle,
      stats: makeStats({ social_fund_paid_count: '3', membership_fee_paid_count: '0' }),
    });

    const data = await getDashboardData(12, 3);
    // pool = savings(35000) + 3×2000 + 0 = 41000
    expect(data.stats.totalSocialFund).toBe(6000);
  });
});

describe('getDashboardData — month resolution', () => {
  test('uses explicit month parameter when provided', async () => {
    setupHappyPath();
    const data = await getDashboardData(12, 2);
    expect(data.month).toBe(2);
  });

  test('falls back to cycle.current_month when month is null', async () => {
    const cycle = makeCycle({ current_month: 3 });
    setupHappyPath({ cycle });
    const data = await getDashboardData(12, null);
    expect(data.month).toBe(3);
  });
});

describe('getDashboardData — cycle not found', () => {
  test('throws 404 error when cycle does not exist', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                   // SET TRANSACTION
      .mockResolvedValueOnce({})                   // BEGIN READ ONLY
      .mockResolvedValueOnce({ rows: [] })          // cycle — empty
      .mockResolvedValueOnce({});                  // ROLLBACK

    await expect(getDashboardData(999, 1)).rejects.toMatchObject({
      message: 'Cycle not found',
      statusCode: 404,
    });

    // ROLLBACK called and client released
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(calls.some((q) => typeof q === 'string' && q.includes('ROLLBACK'))).toBe(true);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

describe('getDashboardData — declaration counts', () => {
  test('missing count = totalMembers - submitted (never negative)', async () => {
    // 3 members, only 2 submitted — missing should be 1
    setupHappyPath({ declCounts: { submitted: '2', processed: '1', pending: '1' } });
    const data = await getDashboardData(12, 3);
    expect(data.declarations.missing).toBe(1);
    expect(data.declarations.submitted).toBe(2);
  });

  test('missing is 0 when all members submitted (Math.max guard)', async () => {
    // submitted count equals totalMembers → missing = max(0, 0) = 0
    setupHappyPath({ declCounts: { submitted: '3', processed: '3', pending: '0' } });
    const data = await getDashboardData(12, 3);
    expect(data.declarations.missing).toBe(0);
  });

  test('missing is 0 even when submitted reports more than totalMembers', async () => {
    // Edge: duplicate submissions in same month (shouldn't happen but guard must hold)
    setupHappyPath({ declCounts: { submitted: '5', processed: '3', pending: '2' } });
    const data = await getDashboardData(12, 3);
    expect(data.declarations.missing).toBe(0);
  });
});

describe('getDashboardData — return shape', () => {
  test('returns correct top-level keys', async () => {
    setupHappyPath();
    const data = await getDashboardData(12, 3);
    expect(data).toHaveProperty('cycle');
    expect(data).toHaveProperty('month');
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('monthlyBalances');
    expect(data).toHaveProperty('declarations');
    expect(data).toHaveProperty('recentLoans');
    expect(data).toHaveProperty('recentDeclarations');
  });

  test('stats object contains all expected keys', async () => {
    setupHappyPath();
    const data = await getDashboardData(12, 3);
    const s = data.stats;
    expect(s).toHaveProperty('totalMembers');
    expect(s).toHaveProperty('activeMembers');
    expect(s).toHaveProperty('pool');
    expect(s).toHaveProperty('unborrowed');
    expect(s).toHaveProperty('netCashLentOut');
    expect(s).toHaveProperty('totalDisbursedPrincipal');
    expect(s).toHaveProperty('totalRepaidPrincipal');
    expect(s).toHaveProperty('interestRate');
  });

  test('releases client on success', async () => {
    setupHappyPath();
    await getDashboardData(12, 3);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  test('releases client even when an error is thrown', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})  // SET TRANSACTION
      .mockResolvedValueOnce({})  // BEGIN
      .mockRejectedValueOnce(new Error('DB down'))  // cycle query fails
      .mockResolvedValueOnce({});  // ROLLBACK

    await expect(getDashboardData(12, 3)).rejects.toThrow('DB down');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});
