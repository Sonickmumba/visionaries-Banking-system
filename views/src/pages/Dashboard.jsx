// export function Dashboard() {
//   return (
//     <div className="p-6">
//       <h2 className="text-2xl font-bold text-gray-900 mb-4">Dashboard</h2>
//       <p className="text-gray-600">Welcome to the Village Banking System.</p>
//     </div>
//   );
// }


import { useState } from 'react';
import { mockMembers } from '../store/mockData';
import { useMonthStore, monthStore } from '../store/monthStore';
import { getCurrentMonthData } from '../store/dataSelector';
import {
  analyzeMembers,
  calculateUnborrowedAndInterest,
  calculateCommonInterestAllocations,
  canUseAllMembersOption,
  AllocationMethod,
  CommonInterestAllocation,
} from '../utils/commonInterestCalculator';
import { useSelector } from 'react-redux';

export default function Dashboard() {
    const currentMonth = useSelector(state => state.month.currentMonth);
//   const { currentMonth } = useMonthStore();
  const monthData = getCurrentMonthData(currentMonth);
  const stats = monthData.dashboardStats;
  const recentLoans = monthData.loans.slice(0, 3);
  const recentDeclarations = monthData.declarations.slice(0, 3);

  const [showMonthEndModal, setShowMonthEndModal] = useState(false);
  const [showCommonInterestModal, setShowCommonInterestModal] = useState(false);
  const [selectedAllocationMethod, setSelectedAllocationMethod] = useState<AllocationMethod>('never_borrowed_only');
  const [previewAllocations, setPreviewAllocations] = useState<CommonInterestAllocation[]>([]);

  // Calculate common interest data
  const analysis = analyzeMembers(monthData.monthlyBalances);
  const totalSavingsPrincipal = monthData.monthlyBalances.reduce((sum, b) => sum + b.savingsPrincipal, 0);
  const socialFundCollected = monthData.monthlyBalances.filter(b => b.socialFundPaid).length * 240;
  const membershipFeesCollected = monthData.monthlyBalances.filter(b => b.membershipFeePaid).length * 80;
  const totalLoansDisbursed = monthData.loans.reduce((sum, l) => sum + l.amount, 0);
  const { unborrowed, commonInterest } = calculateUnborrowedAndInterest(
    totalSavingsPrincipal,
    socialFundCollected,
    membershipFeesCollected,
    totalLoansDisbursed
  );

  const handleProceedToCommonInterest = () => {
    setShowMonthEndModal(false);
    setShowCommonInterestModal(true);
    // Set default allocations
    handleAllocationMethodChange('never_borrowed_only');
  };

  const handleAllocationMethodChange = (method: AllocationMethod) => {
    setSelectedAllocationMethod(method);
    const allocations = calculateCommonInterestAllocations(
      monthData.monthlyBalances,
      method,
      commonInterest,
      analysis
    );
    setPreviewAllocations(allocations);
  };

  const handleConfirmCommonInterest = () => {
    if (currentMonth >= 2) {
      alert('Month 2 is the last available demo month. Full cycle support coming soon!');
      setShowCommonInterestModal(false);
      return;
    }

    // In a real implementation, save previewAllocations to the database
    console.log('Common Interest Allocations:', previewAllocations);

    monthStore.advanceToNextMonth();
    setShowCommonInterestModal(false);
    alert(`Successfully processed common interest and advanced to Month ${currentMonth + 1}!`);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Month {currentMonth} ({currentMonth === 1 ? 'January' : 'February'} 2026) - End of Month Summary
          </p>
        </div>
        <button
          onClick={() => setShowMonthEndModal(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advance to Month {currentMonth + 1}
        </button>
      </div>

      {/* Month End Processing Modal */}
      {showMonthEndModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Process Month {currentMonth} End & Advance to Month {currentMonth + 1}</h2>
              <button
                onClick={() => setShowMonthEndModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>Month-End Processing:</strong> This will calculate final interest, process common interest allocations,
                  assess penalties, and carry forward all balances to Month {currentMonth + 1}.
                </p>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Month {currentMonth} Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Total Savings</p>
                    <p className="text-lg font-bold text-green-600">K{stats.totalSavings.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Loans</p>
                    <p className="text-lg font-bold text-blue-600">K{stats.totalLoans.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Unborrowed Pool</p>
                    <p className="text-lg font-bold text-purple-600">K{stats.unborrowed.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Active Members</p>
                    <p className="text-lg font-bold text-orange-600">{stats.activeMembers}/{stats.totalMembers}</p>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-900">
                  <strong>⚠️ Important:</strong> This action will finalize Month {currentMonth} and cannot be undone.
                  Ensure all declarations, loans, and penalties have been processed.
                </p>
              </div>

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowMonthEndModal(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProceedToCommonInterest}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Continue to Common Interest
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Common Interest Allocation Modal */}
      {showCommonInterestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Process Common Interest Allocation - Month {currentMonth}</h2>
              <button
                onClick={() => setShowCommonInterestModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Analysis Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-3">Borrowing Analysis</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Never Borrowed</p>
                    <p className="text-2xl font-bold text-gray-900">{analysis.neverBorrowed.length}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Below Minimum</p>
                    <p className="text-2xl font-bold text-orange-600">{analysis.belowMinimum.length}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">At/Above Minimum</p>
                    <p className="text-2xl font-bold text-green-600">{analysis.atOrAboveMinimum.length}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Total Shortfall</p>
                    <p className="text-2xl font-bold text-red-600">K{analysis.totalShortfall.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* Financial Summary */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="font-semibold text-purple-900 mb-3">Common Interest Calculation</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Unborrowed Money</p>
                    <p className="text-xl font-bold text-purple-900">K{unborrowed.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      (Savings + Fees - Loans)
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Interest Rate</p>
                    <p className="text-xl font-bold text-purple-900">15%</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg">
                    <p className="text-xs text-gray-600">Common Interest</p>
                    <p className="text-xl font-bold text-purple-900">K{commonInterest.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">To be allocated</p>
                  </div>
                </div>
              </div>

              {/* Allocation Method Selection */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Select Allocation Method</h3>
                <div className="space-y-3">
                  {/* Option 1: Never Borrowed Only */}
                  <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                    selectedAllocationMethod === 'never_borrowed_only'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="allocationMethod"
                      value="never_borrowed_only"
                      checked={selectedAllocationMethod === 'never_borrowed_only'}
                      onChange={(e) => handleAllocationMethodChange(e.target.value as AllocationMethod)}
                      className="mt-1"
                      disabled={analysis.neverBorrowed.length === 0}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Never Borrowed Only</p>
                      <p className="text-sm text-gray-600">
                        Distribute equally among {analysis.neverBorrowed.length} members who never borrowed
                        {analysis.neverBorrowed.length > 0 && ` (K${(commonInterest / analysis.neverBorrowed.length).toFixed(2)} each)`}
                      </p>
                    </div>
                  </label>

                  {/* Option 2: Never Borrowed + Below Minimum */}
                  <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                    selectedAllocationMethod === 'never_borrowed_and_below_minimum'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="allocationMethod"
                      value="never_borrowed_and_below_minimum"
                      checked={selectedAllocationMethod === 'never_borrowed_and_below_minimum'}
                      onChange={(e) => handleAllocationMethodChange(e.target.value as AllocationMethod)}
                      className="mt-1"
                      disabled={analysis.neverBorrowed.length + analysis.belowMinimum.length === 0}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Never Borrowed + Below Minimum</p>
                      <p className="text-sm text-gray-600">
                        Distribute proportionally by shortfall among {analysis.neverBorrowed.length + analysis.belowMinimum.length} members
                        who haven't met the K20,000 minimum
                      </p>
                    </div>
                  </label>

                  {/* Option 3: All Members */}
                  <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                    selectedAllocationMethod === 'all_members'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${!canUseAllMembersOption(analysis, monthData.monthlyBalances.length) ? 'opacity-50' : ''}`}>
                    <input
                      type="radio"
                      name="allocationMethod"
                      value="all_members"
                      checked={selectedAllocationMethod === 'all_members'}
                      onChange={(e) => handleAllocationMethodChange(e.target.value as AllocationMethod)}
                      className="mt-1"
                      disabled={!canUseAllMembersOption(analysis, monthData.monthlyBalances.length)}
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">All Members</p>
                      <p className="text-sm text-gray-600">
                        Distribute equally among all 10 members
                        {canUseAllMembersOption(analysis, monthData.monthlyBalances.length)
                          ? ` (K${(commonInterest / 10).toFixed(2)} each)`
                          : ' - Only available when all members meet minimum borrowing'}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Preview Allocations Table */}
              {previewAllocations.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <h3 className="font-semibold text-gray-900">Preview: Member Allocations</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Shortfall</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Assigned Base</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Charge (15%)</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {previewAllocations.map((allocation) => (
                          <tr key={allocation.memberId} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="font-medium text-gray-900">{allocation.memberName}</div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                allocation.eligibilityStatus === 'never_borrowed' ? 'bg-blue-100 text-blue-800' :
                                allocation.eligibilityStatus === 'borrowed_below_minimum' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-green-100 text-green-800'
                              }`}>
                                {allocation.eligibilityStatus.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-gray-900">
                              K{allocation.shortfall.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right font-medium text-gray-900">
                              K{allocation.assignedBase.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-purple-600">
                              K{allocation.charge.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td colSpan={4} className="px-4 py-3 text-right text-gray-900">
                            Total Common Interest Allocated:
                          </td>
                          <td className="px-4 py-3 text-right text-purple-900">
                            K{previewAllocations.reduce((sum, a) => sum + a.charge, 0).toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowCommonInterestModal(false);
                    setShowMonthEndModal(true);
                  }}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmCommonInterest}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  disabled={previewAllocations.length === 0}
                >
                  Confirm & Advance to Month {currentMonth + 1}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Savings"
          value={`K${stats.totalSavings.toLocaleString()}`}
          icon="💰"
          color="green"
        />
        <StatCard
          title="Total Loans"
          value={`K${stats.totalLoans.toLocaleString()}`}
          icon="🏦"
          color="blue"
        />
        <StatCard
          title="Unborrowed Pool"
          value={`K${stats.unborrowed.toLocaleString()}`}
          icon="💵"
          color="purple"
        />
        <StatCard
          title="Active Members"
          value={`${stats.activeMembers}/${stats.totalMembers}`}
          icon="👥"
          color="orange"
        />
      </div>

      {/* Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AlertCard
          title="Declarations Submitted"
          count={8}
          color="yellow"
          description="8 out of 10 members declared"
        />
        <AlertCard
          title="Loans Disbursed"
          count={2}
          color="blue"
          description="Alice & Grace received loans"
        />
        <AlertCard
          title="Unpaid Penalties"
          count={stats.unpaidPenalties}
          color="red"
          description="Ivy & Jack - failure to declare"
        />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Loans */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Loans</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {recentLoans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{loan.memberName}</p>
                    <p className="text-sm text-gray-600">K{loan.amount.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {loan.status}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">{loan.disbursedDate}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Declarations */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Declarations</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {recentDeclarations.map((dec) => (
                <div key={dec.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{dec.memberName}</p>
                    <p className="text-sm text-gray-600">Month {dec.month}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {dec.status}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">{new Date(dec.submittedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionButton icon="📝" label="New Declaration" />
          <QuickActionButton icon="💰" label="Record Savings" />
          <QuickActionButton icon="🏦" label="Process Loan" />
          <QuickActionButton icon="📊" label="View Reports" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: string; icon: string; color: string }) {
  const colors = {
    green: 'bg-green-50 border-green-200',
    blue: 'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
    orange: 'bg-orange-50 border-orange-200',
  };

  return (
    <div className={`${colors[color]} border rounded-lg p-6`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-600 text-sm font-medium">{title}</p>
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function AlertCard({ title, count, color, description }: { title: string; count: number; color: string; description: string }) {
  const colors = {
    yellow: 'bg-yellow-50 border-yellow-300 text-yellow-800',
    blue: 'bg-blue-50 border-blue-300 text-blue-800',
    red: 'bg-red-50 border-red-300 text-red-800',
  };

  return (
    <div className={`${colors[color]} border rounded-lg p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm opacity-75 mt-1">{description}</p>
        </div>
        <div className="text-3xl font-bold">{count}</div>
      </div>
    </div>
  );
}

function QuickActionButton({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="flex flex-col items-center gap-2 p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </button>
  );
}

