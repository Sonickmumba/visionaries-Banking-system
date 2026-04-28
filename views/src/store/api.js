/**
 * RTK Query API service — single source of truth for all backend calls.
 *
 * Benefits over manual createAsyncThunk + axios:
 *   • Automatic caching with configurable TTL (keepUnusedDataFor)
 *   • Request deduplication — two subscribers share one in-flight request
 *   • Automatic re-fetch via tag invalidation on mutations
 *   • Built-in AbortController on component unmount
 *   • isFetching / isLoading distinction (stale-while-revalidate)
 */
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const api = createApi({
  reducerPath: 'api',

  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    credentials: 'include', // send httpOnly cookie on every request
  }),

  // Cache tags used for automatic invalidation
  tagTypes: ['Dashboard', 'Cycle', 'CommonInterest', 'Members', 'PendingMembers', 'Loans', 'Declarations', 'Savings', 'Approvals', 'Penalties'],

  // Keep unused cache entries for 60 s before garbage collection
  keepUnusedDataFor: 60,

  endpoints: (builder) => ({

    // ── Cycles ──────────────────────────────────────────────────────────────
    /**
     * GET /api/cycles/active
     * Primary entry point — gives us the cycleId + currentMonth needed for
     * all other queries. Cached indefinitely (until invalidated by processMonthEnd).
     *
     * Backend returns { cycle: { id, name, start_date, end_date, current_month,
     *   status, config, member_count } }. We normalise to camelCase here so every
     * consumer uses the same shape regardless of DB column naming conventions.
     */
    getActiveCycle: builder.query({
      query: () => '/cycles/active',
      transformResponse: (res) => {
        const c = res.cycle;
        if (!c) return null;
        return {
          id:                     c.id,
          name:                   c.name,
          startDate:              c.start_date,
          endDate:                c.end_date,
          currentMonth:           c.current_month,
          status:                 c.status,
          config:                 c.config,
          memberCount:            c.member_count,
          // Convenience aliases consumed by Dashboard common-interest modal
          interestRate:           c.config?.commonInterestRate ?? 0.15,
          minimumBorrowingAmount: c.config?.minBorrowing       ?? 20000,
        };
      },
      providesTags: ['Cycle'],
      keepUnusedDataFor: 300, // cycle meta changes rarely
    }),

    /**
     * GET /api/cycles
     * Full list with per-cycle stats (total_savings / total_loans from the
     * current month's monthly_balances, joined server-side — no N+1 queries).
     */
    getAllCycles: builder.query({
      query: () => '/cycles',
      transformResponse: (res) =>
        (res.cycles ?? []).map((c) => ({
          id:           c.id,
          name:         c.name,
          startDate:    c.start_date,
          endDate:      c.end_date,
          currentMonth: c.current_month,
          status:       c.status,
          config:       c.config,
          memberCount:  c.member_count,
          totalSavings: Number(c.total_savings ?? 0),
          totalLoans:   Number(c.total_loans   ?? 0),
        })),
      providesTags: ['Cycle'],
    }),

    /**
     * POST /api/cycles   (admin only — enforced server-side)
     * Body: { name, start_date, end_date, config }
     * Invalidates the cycle list so the new entry appears immediately.
     */
    createCycle: builder.mutation({
      query: (body) => ({
        url:    '/cycles',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Cycle'],
    }),

    // ── Dashboard aggregate ──────────────────────────────────────────────────
    /**
     * GET /api/dashboard/cycle/:cycleId?month=M
     * Single round-trip for the entire dashboard page.
     * Includes monthlyBalances for front-end commonInterestCalculator.
     */
    getDashboard: builder.query({
      query: ({ cycleId, month }) => ({
        url: `/dashboard/cycle/${cycleId}`,
        params: month ? { month } : {},
      }),
      transformResponse: (res) => res.data,
      providesTags: ['Dashboard'],
    }),

    // ── Common interest preview (front-end calculator handles math) ──────────
    /**
     * POST /api/common-interest/cycle/:cycleId/apply
     * Persists the allocations calculated by commonInterestCalculator.js
     * on the front-end. Called only when admin confirms.
     */
    applyCommonInterest: builder.mutation({
      query: ({ cycleId, month, allocationMethod }) => ({
        url: `/common-interest/cycle/${cycleId}/apply`,
        method: 'POST',
        body: { month, allocationMethod },
      }),
      transformResponse: (res) => res.data,
      // Do not invalidate yet — we still need to call processMonthEnd
    }),

    // ── Month-end processing ─────────────────────────────────────────────────
    /**
     * POST /api/month-processing/cycle/:cycleId/process
     * Advances the cycle to the next month.
     * Invalidates Dashboard + Cycle so next navigation re-fetches fresh data.
     */
    processMonthEnd: builder.mutation({
      query: ({ cycleId }) => ({
        url: `/month-processing/cycle/${cycleId}/process`,
        method: 'POST',
      }),
      transformResponse: (res) => res.data,
      invalidatesTags: ['Dashboard', 'Cycle', 'CommonInterest', 'Loans', 'Declarations'],
    }),

    // ── Loans (used by Loans page — also invalidated here for dashboard refresh) ─
    getLoans: builder.query({
      query: ({ cycleId, status, member_id } = {}) => ({
        url: '/loans',
        params: { cycleId, status, member_id },
      }),
      transformResponse: (res) =>
        (res.loans ?? []).map((l) => ({
          id:                 l.id,
          memberId:           l.member_id,
          cycleId:            l.cycle_id,
          loanType:           l.loan_type,
          amount:             Number(l.amount             ?? 0),
          disbursedDate:      l.disbursed_date,
          outstandingBalance: Number(l.outstanding_balance ?? 0),
          monthlyInterest:    Number(l.monthly_interest    ?? 0),
          status:             l.status,
          userId:             l.user_id,
          memberName:         l.member_name ?? '',
        })),
      providesTags: ['Loans'],
    }),

    /**
     * GET /api/loans/stats?cycleId=N
     * Aggregate totals for the summary cards.
     */
    getLoansStats: builder.query({
      query: ({ cycleId }) => ({
        url: '/loans/stats',
        params: { cycleId },
      }),
      transformResponse: (res) => {
        const s = res.stats ?? {};
        return {
          totalLoans:            Number(s.total_loans             ?? 0),
          totalAmountDisbursed:  Number(s.total_amount_disbursed  ?? 0),
          totalOutstanding:      Number(s.total_outstanding        ?? 0),
          totalMonthlyInterest:  Number(s.total_monthly_interest   ?? 0),
          activeLoans:           Number(s.active_loans             ?? 0),
          repaidLoans:           Number(s.repaid_loans             ?? 0),
        };
      },
      providesTags: ['Loans'],
    }),

    /**
     * POST /api/loans/disburse  (admin only)
     * Body: { member_id, cycle_id, loan_type, amount, disbursed_date }
     */
    disburseLoan: builder.mutation({
      query: (body) => ({
        url:    '/loans/disburse',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Loans', 'Dashboard', 'Members'],
    }),

    /**
     * POST /api/loans/:loanId/repayment  (admin only)
     * Body: { principal_amount, interest_amount?, date }
     */
    recordLoanRepayment: builder.mutation({
      query: ({ loanId, ...body }) => ({
        url:    `/loans/${loanId}/repayment`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Loans', 'Dashboard', 'Members'],
    }),

    // ── Members ─────────────────────────────────────────────────────────────
    /**
     * GET /api/members?cycleId=N&status=...
     * Returns members with current-month balance columns joined server-side.
     * Cached 60 s; invalidated by enrollMember / updateMemberStatus.
     */
    getMembers: builder.query({
      query: ({ cycleId, status } = {}) => ({
        url: '/members',
        params: { cycleId, status },
      }),
      transformResponse: (res) =>
        (res.members ?? []).map((m) => ({
          id:                  m.id,
          userId:              m.user_id,
          cycleId:             m.cycle_id,
          joinedDate:          m.joined_date,
          status:              m.status,
          fullName:            m.full_name,
          email:               m.email,
          phone:               m.phone,
          address:             m.address,
          // Balance columns (may be null if no balance row yet)
          accumulatedSavings:  Number(m.accumulated_savings  ?? 0),
          outstandingLoan:     Number(m.outstanding_loan     ?? 0),
          cumulativeBorrowing: Number(m.cumulative_borrowing ?? 0),
          savingsPrincipal:    Number(m.savings_principal    ?? 0),
          commonInterestDue:   Number(m.common_interest_due  ?? 0),
          socialFundPaid:      m.social_fund_paid      ?? false,
          membershipFeePaid:   m.membership_fee_paid   ?? false,
          complianceStatus:    m.compliance_status ?? 'never_borrowed',
        })),
      providesTags: ['Members'],
    }),

    /**
     * GET /api/members/:id/balance?month=N
     * Per-member balance for a specific month.
     * Used by the member detail panel when drilling into a past month.
     */
    getMemberBalance: builder.query({
      query: ({ memberId, month }) => ({
        url: `/members/${memberId}/balance`,
        params: { month },
      }),
      transformResponse: (res) => res.balance,
      providesTags: (_r, _e, { memberId, month }) => [
        { type: 'Members', id: `balance-${memberId}-${month}` },
      ],
    }),

    /**
     * POST /api/members/enroll  (admin only — enforced server-side)
     * Creates user account (if new email) + member record atomically.
     * Body: { full_name, email, phone, address, cycle_id, joined_date }
     */
    enrollMember: builder.mutation({
      query: (body) => ({
        url:    '/members/enroll',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Members', 'Cycle', 'Dashboard'],
    }),

    /**
     * PUT /api/members/:id  (admin only)
     * Updates member status: active | inactive | exited
     */
    updateMemberStatus: builder.mutation({
      query: ({ id, status }) => ({
        url:    `/members/${id}`,
        method: 'PUT',
        body:   { status },
      }),
      invalidatesTags: ['Members', 'Dashboard'],
    }),

    /**
     * GET /api/members/pending  (admin only)
     * Users who registered but haven't been enrolled in any cycle yet.
     * Returns { pendingUsers: [{ id, email, full_name, phone, address, created_at }] }
     */
    getPendingMembers: builder.query({
      query: () => '/members/pending',
      transformResponse: (res) =>
        (res.pendingUsers ?? []).map((u) => ({
          id:        u.id,
          email:     u.email,
          fullName:  u.full_name,
          phone:     u.phone,
          address:   u.address,
          createdAt: u.created_at,
        })),
      providesTags: ['PendingMembers'],
    }),

    /**
     * POST /api/members/:userId/approve  (admin only)
     * Approves a pending user and enrolls them into the given cycle.
     * Body: { cycle_id, joined_date }
     */
    approveMember: builder.mutation({
      query: ({ userId, cycle_id, joined_date }) => ({
        url:    `/members/${userId}/approve`,
        method: 'POST',
        body:   { cycle_id, joined_date },
      }),
      invalidatesTags: ['Members', 'PendingMembers', 'Cycle', 'Dashboard'],
    }),

    // ── Declarations ─────────────────────────────────────────────────────────
    /**
     * GET /api/declarations?cycleId=N&month=N
     */
    getDeclarations: builder.query({
      query: ({ cycleId, month } = {}) => ({
        url: '/declarations',
        params: { cycleId, month },
      }),
      transformResponse: (res) => res.declarations ?? [],
      providesTags: ['Declarations'],
    }),

    /**
     * GET /api/declarations/stats?cycleId=N&month=N
     */
    getDeclarationStats: builder.query({
      query: ({ cycleId, month }) => ({
        url: '/declarations/stats',
        params: { cycleId, month },
      }),
      transformResponse: (res) => res,
      providesTags: ['Declarations'],
    }),

    /**
     * GET /api/declarations/missing?cycleId=N&month=N
     * Members who haven't submitted a declaration yet.
     */
    getMissingDeclarations: builder.query({
      query: ({ cycleId, month }) => ({
        url: '/declarations/missing',
        params: { cycleId, month },
      }),
      transformResponse: (res) => res.members ?? [],
      providesTags: ['Declarations'],
    }),

    /**
     * POST /api/declarations
     * Body: { member_id, cycle_id, savings_amount, loan_request,
     *         principal_repayment, interest_repayment, payment_proof_id? }
     * Creates a savings-declaration approval when savings_amount > 0.
     */
    submitDeclaration: builder.mutation({
      query: (body) => ({
        url:    '/declarations',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Declarations', 'Approvals'],
    }),

    // ── Penalties ────────────────────────────────────────────────────────────
    /**
     * GET /api/penalties/cycle/:cycleId?month=N
     */
    getPenalties: builder.query({
      query: ({ cycleId, month } = {}) => ({
        url: `/penalties/cycle/${cycleId}`,
        params: month ? { month } : {},
      }),
      transformResponse: (res) => res.penalties ?? [],
      providesTags: ['Penalties'],
    }),

    // ── Savings ──────────────────────────────────────────────────────────────
    /**
     * GET /api/savings?cycleId=N&month=N
     * Returns savings records for every member in the cycle for the given month.
     */
    getSavings: builder.query({
      query: ({ cycleId, month }) => ({
        url:    '/savings',
        params: { cycleId, month },
      }),
      transformResponse: (res) =>
        (res.savings ?? []).map((s) => ({
          id:                  s.id,
          memberId:            s.member_id,
          cycleId:             s.cycle_id,
          month:               s.month,
          principalDeposit:    Number(s.principal_deposit   ?? 0),
          totalPrincipal:      Number(s.total_principal      ?? 0),
          cumulativePrincipal: Number(s.cumulative_principal ?? 0),
          savingsInterest:     Number(s.savings_interest     ?? 0),
          accumulatedSavings:  Number(s.accumulated_savings  ?? 0),
          memberName:          s.member_name ?? '',
        })),
      providesTags: ['Savings'],
    }),

    /**
     * GET /api/savings/stats?cycleId=N&month=N
     * Aggregate totals for the summary cards.
     */
    getSavingsStats: builder.query({
      query: ({ cycleId, month }) => ({
        url:    '/savings/stats',
        params: { cycleId, month },
      }),
      transformResponse: (res) => {
        const s = res.stats ?? {};
        return {
          totalDepositors:        Number(s.total_depositors         ?? 0),
          totalPrincipalDeposited: Number(s.total_principal_deposited ?? 0),
          totalPrincipal:          Number(s.total_principal           ?? 0),
          totalInterest:           Number(s.total_interest            ?? 0),
          totalAccumulated:        Number(s.total_accumulated         ?? 0),
        };
      },
      providesTags: ['Savings'],
    }),

    /**
     * POST /api/savings/deposit  (admin only)
     * Body: { member_id, cycle_id, amount, date }
     */
    recordSavingsDeposit: builder.mutation({
      query: (body) => ({
        url:    '/savings/deposit',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Savings', 'Dashboard', 'Members'],
    }),

    // ── Approvals ────────────────────────────────────────────────────────────
    /**
     * GET /api/approvals/stats?cycleId=N
     * Aggregate pending counts split by type.
     */
    getApprovalStats: builder.query({
      query: ({ cycleId }) => ({
        url:    '/approvals/stats',
        params: { cycleId },
      }),
      transformResponse: (res) => res,
      providesTags: ['Approvals'],
    }),

    /**
     * GET /api/approvals?cycleId=N&type=...&status=...&limit=N&offset=N
     * Paginated, filterable list of approvals.
     */
    getApprovals: builder.query({
      query: ({ cycleId, type, status, limit = 50, offset = 0 } = {}) => ({
        url:    '/approvals',
        params: { cycleId, type, status, limit, offset },
      }),
      transformResponse: (res) => res.approvals ?? [],
      providesTags: ['Approvals'],
    }),

    /**
     * PATCH /api/approvals/savings/:id/approve  (admin only)
     */
    approveSavingsDeclaration: builder.mutation({
      query: (approvalId) => ({
        url:    `/approvals/savings/${approvalId}/approve`,
        method: 'PATCH',
      }),
      invalidatesTags: ['Approvals', 'Savings', 'Declarations', 'Members', 'Dashboard'],
    }),

    /**
     * PATCH /api/approvals/savings/:id/reject  (admin only)
     * Body: { reason }
     */
    rejectSavingsDeclaration: builder.mutation({
      query: ({ approvalId, reason }) => ({
        url:    `/approvals/savings/${approvalId}/reject`,
        method: 'PATCH',
        body:   { reason },
      }),
      invalidatesTags: ['Approvals', 'Savings', 'Members'],
    }),

    /**
     * PATCH /api/approvals/repayments/:id/approve  (admin only)
     */
    approveLoanRepayment: builder.mutation({
      query: (approvalId) => ({
        url:    `/approvals/repayments/${approvalId}/approve`,
        method: 'PATCH',
      }),
      invalidatesTags: ['Approvals', 'Loans', 'Members', 'Dashboard'],
    }),

    /**
     * PATCH /api/approvals/repayments/:id/reject  (admin only)
     * Body: { reason }
     */
    rejectLoanRepayment: builder.mutation({
      query: ({ approvalId, reason }) => ({
        url:    `/approvals/repayments/${approvalId}/reject`,
        method: 'PATCH',
        body:   { reason },
      }),
      invalidatesTags: ['Approvals', 'Loans', 'Members'],
    }),

    /**
     * POST /api/common-interest/cycle/:cycleId/pay
     * Body: { member_id, month, amount, payment_date }
     * Records a member's common-interest payment (with optional late penalty).
     */
    payCommonInterest: builder.mutation({
      query: ({ cycleId, ...body }) => ({
        url:    `/common-interest/cycle/${cycleId}/pay`,
        method: 'POST',
        body,
      }),
      transformResponse: (res) => res.data,
      invalidatesTags: ['Members', 'Dashboard'],
    }),

    /**
     * POST /api/common-interest/cycle/:cycleId/enforce
     * Body: { month }
     * Converts all unpaid common interest for a month into loans.
     */
    enforceCommonInterest: builder.mutation({
      query: ({ cycleId, month }) => ({
        url:    `/common-interest/cycle/${cycleId}/enforce`,
        method: 'POST',
        body:   { month },
      }),
      transformResponse: (res) => res.data,
      invalidatesTags: ['Members', 'Dashboard', 'Loans'],
    }),
  }),
});

// Auto-generated React hooks — import these in components
export const {
  useGetActiveCycleQuery,
  useGetAllCyclesQuery,
  useCreateCycleMutation,
  useGetDashboardQuery,
  useApplyCommonInterestMutation,
  useProcessMonthEndMutation,
  usePayCommonInterestMutation,
  useEnforceCommonInterestMutation,
  useGetLoansQuery,
  useGetLoansStatsQuery,
  useDisburseLoanMutation,
  useRecordLoanRepaymentMutation,
  useGetMembersQuery,
  useGetMemberBalanceQuery,
  useEnrollMemberMutation,
  useUpdateMemberStatusMutation,
  useGetPendingMembersQuery,
  useApproveMemberMutation,
  useGetDeclarationsQuery,
  useGetDeclarationStatsQuery,
  useGetMissingDeclarationsQuery,
  useSubmitDeclarationMutation,
  useGetPenaltiesQuery,
  useGetSavingsQuery,
  useGetSavingsStatsQuery,
  useRecordSavingsDepositMutation,
  useGetApprovalStatsQuery,
  useGetApprovalsQuery,
  useApproveSavingsDeclarationMutation,
  useRejectSavingsDeclarationMutation,
  useApproveLoanRepaymentMutation,
  useRejectLoanRepaymentMutation,
} = api;
