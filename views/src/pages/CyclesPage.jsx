import { useState, useCallback } from 'react';
import { useGetAllCyclesQuery, useCreateCycleMutation } from '../store/api.js';

// ─── Constants ─────────────────────────────────────────────────────────────
const INITIAL_FORM = {
  name: '',
  startDate: '',
  endDate: '',
  maxSavings: 30000,
  minBorrowing: 20000,
  savingsInterestRate: 15,
  loanInterestRate: 15,
  commonInterestRate: 15,
  socialFund: 240,
  membershipFee: 80,
  failureToDecllarePenalty: 100,
  declarationWindowStart: 28,
  declarationWindowEnd: 3,
};

// ─── CyclesPage ─────────────────────────────────────────────────────────────
export default function CyclesPage() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: cycles = [], isLoading, error } = useGetAllCyclesQuery();
  const [createCycle, { isLoading: creating }] = useCreateCycleMutation();

  // ── Local state ───────────────────────────────────────────────────────────
  const [selectedCycleId, setSelectedCycleId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState(null);

  // Derive selected cycle — default to first in list when data arrives
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId) ?? cycles[0] ?? null;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name.includes('Rate') || name.includes('Interest')
          ? parseFloat(value)
          : name === 'name' || name.includes('Date')
          ? value
          : parseFloat(value) || 0,
    }));
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setFormError(null);
      try {
        // Interest rates are entered as whole-number percentages (e.g. 15 = 15%)
        // and stored as decimals (0.15) so the ConfigItem display (* 100) is correct.
        await createCycle({
          name:       formData.name,
          start_date: formData.startDate,
          end_date:   formData.endDate,
          config: {
            maxSavings:               formData.maxSavings,
            minBorrowing:             formData.minBorrowing,
            savingsInterestRate:      formData.savingsInterestRate / 100,
            loanInterestRate:         formData.loanInterestRate   / 100,
            commonInterestRate:       formData.commonInterestRate / 100,
            socialFund:               formData.socialFund,
            membershipFee:            formData.membershipFee,
            failureToDecllarePenalty: formData.failureToDecllarePenalty,
            declarationWindowStart:   formData.declarationWindowStart,
            declarationWindowEnd:     formData.declarationWindowEnd,
          },
        }).unwrap();
        setShowCreateModal(false);
        setFormData(INITIAL_FORM);
      } catch (err) {
        setFormError(err?.data?.error ?? 'Failed to create cycle. Please try again.');
      }
    },
    [formData, createCycle]
  );

  const handleCloseModal = useCallback(() => {
    setShowCreateModal(false);
    setFormError(null);
    setFormData(INITIAL_FORM);
  }, []);

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-gray-500 text-lg">Loading cycles…</div>
      </div>
    );
  }

  if (error) {
    const message = error?.data?.error ?? 'Failed to load cycles.';
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{message}</div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cycles Management</h1>
          <p className="text-gray-600 mt-1">Manage banking cycles and configurations</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Create New Cycle
        </button>
      </div>

      {/* Create Cycle Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Create New Cycle</h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Server-side error */}
              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
                  {formError}
                </div>
              )}

              {/* Basic Information */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Cycle Name *
                    </label>
                    <input
                      type="text"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Cycle 2026 Q2"
                    />
                  </div>
                  <div></div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      required
                      value={formData.startDate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date *
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      required
                      value={formData.endDate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Financial Limits */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Limits</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Maximum Savings (K) *
                    </label>
                    <input
                      type="number"
                      name="maxSavings"
                      required
                      value={formData.maxSavings}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Minimum Borrowing (K) *
                    </label>
                    <input
                      type="number"
                      name="minBorrowing"
                      required
                      value={formData.minBorrowing}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Interest Rates */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Interest Rates (%)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Savings Interest Rate *
                    </label>
                    <input
                      type="number"
                      name="savingsInterestRate"
                      required
                      step="0.01"
                      value={formData.savingsInterestRate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Loan Interest Rate *
                    </label>
                    <input
                      type="number"
                      name="loanInterestRate"
                      required
                      step="0.01"
                      value={formData.loanInterestRate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Common Interest Rate *
                    </label>
                    <input
                      type="number"
                      name="commonInterestRate"
                      required
                      step="0.01"
                      value={formData.commonInterestRate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Fees & Penalties */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Fees &amp; Penalties (K)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Social Fund *
                    </label>
                    <input
                      type="number"
                      name="socialFund"
                      required
                      value={formData.socialFund}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Membership Fee *
                    </label>
                    <input
                      type="number"
                      name="membershipFee"
                      required
                      value={formData.membershipFee}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Failure to Declare Penalty *
                    </label>
                    <input
                      type="number"
                      name="failureToDecllarePenalty"
                      required
                      value={formData.failureToDecllarePenalty}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Declaration Window */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Declaration Window</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Window Start (Day of Month) *
                    </label>
                    <input
                      type="number"
                      name="declarationWindowStart"
                      required
                      min="1"
                      max="31"
                      value={formData.declarationWindowStart}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">Default: 28th</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Window End (Day of Month) *
                    </label>
                    <input
                      type="number"
                      name="declarationWindowEnd"
                      required
                      min="1"
                      max="31"
                      value={formData.declarationWindowEnd}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">Default: 3rd</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={creating}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cycles List */}
      {cycles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No cycles found. Create your first cycle to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {cycles.map((cycle) => (
            <div
              key={cycle.id}
              onClick={() => setSelectedCycleId(cycle.id)}
              className={`bg-white rounded-lg border-2 p-6 cursor-pointer transition-all ${
                selectedCycle?.id === cycle.id
                  ? 'border-blue-500 shadow-lg'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{cycle.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {cycle.startDate} to {cycle.endDate}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    cycle.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {cycle.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-200">
                <div>
                  <p className="text-xs text-gray-500">Members</p>
                  <p className="text-lg font-semibold text-gray-900">{cycle.memberCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Savings</p>
                  <p className="text-lg font-semibold text-gray-900">
                    K{(cycle.totalSavings / 1000).toFixed(0)}k
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Loans</p>
                  <p className="text-lg font-semibold text-gray-900">
                    K{(cycle.totalLoans / 1000).toFixed(0)}k
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cycle Configuration Details */}
      {selectedCycle && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Cycle Configuration</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <ConfigItem label="Max Savings"       value={`K${(selectedCycle.config?.maxSavings ?? 0).toLocaleString()}`} />
            <ConfigItem label="Min Borrowing"     value={`K${(selectedCycle.config?.minBorrowing ?? 0).toLocaleString()}`} />
            <ConfigItem label="Savings Interest"  value={`${((selectedCycle.config?.savingsInterestRate ?? 0) * 100).toFixed(0)}%`} />
            <ConfigItem label="Loan Interest"     value={`${((selectedCycle.config?.loanInterestRate ?? 0) * 100).toFixed(0)}%`} />
            <ConfigItem label="Common Interest"   value={`${((selectedCycle.config?.commonInterestRate ?? 0) * 100).toFixed(0)}%`} />
            <ConfigItem label="Social Fund"       value={`K${selectedCycle.config?.socialFund ?? 0}`} />
            <ConfigItem label="Membership Fee"    value={`K${selectedCycle.config?.membershipFee ?? 0}`} />
            <ConfigItem label="Failure Penalty"   value={`K${selectedCycle.config?.failureToDecllarePenalty ?? 0}`} />
            <ConfigItem
              label="Declaration Window"
              value={`${selectedCycle.config?.declarationWindowStart ?? '?'}th - ${selectedCycle.config?.declarationWindowEnd ?? '?'}rd`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigItem({ label, value }) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

