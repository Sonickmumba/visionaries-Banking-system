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
  tagTypes: ['Dashboard', 'Cycle', 'CommonInterest', 'Members', 'PendingMembers', 'Loans', 'Declarations'],

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
      transformResponse: (res) => res.data,
      providesTags: ['Loans'],
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
    getDeclarations: builder.query({
      query: ({ cycleId, month } = {}) => ({
        url: '/declarations',
        params: { cycleId, month },
      }),
      transformResponse: (res) => res.data,
      providesTags: ['Declarations'],
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
  useGetLoansQuery,
  useGetMembersQuery,
  useGetMemberBalanceQuery,
  useEnrollMemberMutation,
  useUpdateMemberStatusMutation,
  useGetPendingMembersQuery,
  useApproveMemberMutation,
  useGetDeclarationsQuery,
} = api;
