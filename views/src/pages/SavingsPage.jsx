import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  useGetActiveCycleQuery,
  useGetMembersQuery,
  useGetSavingsQuery,
  useGetSavingsStatsQuery,
  useRecordSavingsDepositMutation,
} from '../store/api.js';
import { exportSavings, exportTransactions } from '../utils/csvExport.js';

const INITIAL_FORM = {
  memberId: '',
  amount:   '',
  date:     new Date().toISOString().slice(0, 10),
};

export default function SavingsPage() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: cycle } = useGetActiveCycleQuery();
  const cycleId      = cycle?.id;
  const currentMonth = cycle?.currentMonth ?? 1;
  const maxSavings   = cycle?.config?.maxSavings ?? 30000;
  const interestRate = cycle?.interestRate ?? 0.15;

  const { data: members = [] } = useGetMembersQuery(
    { cycleId },
    { skip: !cycleId }
  );

  const { data: savings = [], isLoading, error } = useGetSavingsQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId }
  );

  const { data: stats } = useGetSavingsStatsQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId }
  );

  const [recordSavingsDeposit, { isLoading: depositing }] = useRecordSavingsDepositMutation();

  // ── Local state ───────────────────────────────────────────────────────────
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [formData,         setFormData]         = useState(INITIAL_FORM);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!cycleId) return;
      try {
        await recordSavingsDeposit({
          member_id: parseInt(formData.memberId, 10),
          cycle_id:  cycleId,
          amount:    parseFloat(formData.amount),
          date:      formData.date,
        }).unwrap();
        toast.success('Savings deposit recorded successfully.');
        setShowDepositModal(false);
        setFormData(INITIAL_FORM);
      } catch (err) {
        toast.error(err?.data?.error ?? 'Failed to record deposit. Please try again.');
      }
    },
    [cycleId, formData, recordSavingsDeposit]
  );

  const handleCloseModal = useCallback(() => {
    setShowDepositModal(false);
    setFormData(INITIAL_FORM);
  }, []);

  // ── Loading / error ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-gray-500 text-lg">Loading savings…</div>
      </div>
    );
  }

  if (error) {
    const message = error?.data?.error ?? 'Failed to load savings.';
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{message}</div>
      </div>
    );
  }

  // Summary totals — prefer server stats; fall back to client sum for instant updates
  const totalPrincipal   = stats?.totalPrincipal   ?? savings.reduce((s, r) => s + r.totalPrincipal,    0);
  const totalAccumulated = stats?.totalAccumulated ?? savings.reduce((s, r) => s + r.accumulatedSavings, 0);
  const totalInterest    = stats?.totalInterest    ?? savings.reduce((s, r) => s + r.savingsInterest,    0);

  console.log('stats:', stats);
  console.log('savings:', savings);


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Savings Management</h1>
          <p className="text-gray-600 mt-1">Track member savings and interest - Month {currentMonth}</p>
        </div>
        <button
          onClick={() => setShowDepositModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Record Savings Deposit
        </button>
      </div>

      {/* Savings Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Record Savings Deposit</h2>
              <button
                onClick={() => setShowDepositModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Member *
                </label>
                <select
                  name="memberId"
                  required
                  value={formData.memberId}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose a member...</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount (K) *
                </label>
                <input
                  type="number"
                  name="amount"
                  required
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="5000"
                />
                <p className="text-xs text-gray-500 mt-1">Maximum savings cap: K{maxSavings.toLocaleString()} per cycle</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  name="date"
                  required
                  value={formData.date}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={depositing}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={depositing}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {depositing ? 'Saving…' : 'Record Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <p className="text-green-700 text-sm font-medium mb-2">Total Savings Principal</p>
          <p className="text-3xl font-bold text-green-900">K{totalPrincipal.toLocaleString()}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <p className="text-blue-700 text-sm font-medium mb-2">Accumulated Savings</p>
          <p className="text-3xl font-bold text-blue-900">K{totalAccumulated.toLocaleString()}</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <p className="text-purple-700 text-sm font-medium mb-2">Total Interest Earned</p>
          <p className="text-3xl font-bold text-purple-900">K{totalInterest.toLocaleString()}</p>
        </div>
      </div>

      {/* Savings Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Member Savings (Month {currentMonth} - End)</h2>
          <button
            onClick={() => exportSavings(savings)}
            disabled={savings.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Principal Deposit</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Principal</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Interest (month-end)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Accumulated</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cap Remaining</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {savings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                    No savings records for this month yet.
                  </td>
                </tr>
              ) : (
                savings.map((saving) => {
                  const capRemaining = maxSavings - saving.cumulativePrincipal;
                  return (
                    <tr key={saving.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{saving.memberName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        Month {saving.month}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                        K{saving.principalDeposit.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-gray-900">
                        K{saving.totalPrincipal.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-medium">
                        {(() => {
                          const interest = saving.savingsInterest > 0
                            ? saving.savingsInterest
                            : Math.round(saving.cumulativePrincipal * interestRate);
                          const isProjected = saving.savingsInterest === 0;
                          return (
                            <span className={isProjected ? 'text-amber-600' : 'text-green-600'}>
                              {isProjected ? '~' : '+'}K{interest.toLocaleString()}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-semibold">
                        {(() => {
                          const isProjected = saving.savingsInterest === 0;
                          const projected   = saving.cumulativePrincipal + Math.round(saving.cumulativePrincipal * interestRate);
                          const actual      = saving.accumulatedSavings;
                          return (
                            <span className={isProjected ? 'text-amber-600' : 'text-gray-900'}>
                              {isProjected ? '~' : ''}K{(isProjected ? projected : actual).toLocaleString()}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className={`font-medium ${capRemaining < 5000 ? 'text-red-600' : 'text-gray-600'}`}>
                          K{capRemaining.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Transactions — derived from the savings records for this month */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Savings Transactions</h2>
          <button
            onClick={() => exportTransactions(savings)}
            disabled={savings.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {savings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                savings.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{s.memberName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">Month {s.month}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        savings deposit
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-green-600">
                      +K{s.principalDeposit.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
