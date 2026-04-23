import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  useGetActiveCycleQuery,
  useGetMembersQuery,
  useGetLoansQuery,
  useDisburseLoanMutation,
  useRecordLoanRepaymentMutation,
} from '../store/api';
import { exportLoans } from '../utils/csvExport';

export default function LoansPage() {
  const { data: cycle } = useGetActiveCycleQuery();
  const cycleId = cycle?.id;
  const interestRate = cycle?.interestRate ?? 0.15;
  const minimumBorrowingAmount = cycle?.minimumBorrowingAmount ?? 20000;

  const { data: members = [] } = useGetMembersQuery({ cycleId }, { skip: !cycleId });
  const { data: loans = [], isLoading: loansLoading } = useGetLoansQuery({ cycleId }, { skip: !cycleId });

  const [disburseLoan, { isLoading: disbursing }] = useDisburseLoanMutation();
  const [recordLoanRepayment, { isLoading: repaying }] = useRecordLoanRepaymentMutation();

  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [showApproveLoanModal, setShowApproveLoanModal] = useState(false);

  const [repaymentForm, setRepaymentForm] = useState({
    loanId: '',
    principalAmount: '',
    interestAmount: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [loanForm, setLoanForm] = useState({
    memberId: '',
    amount: '',
    loanType: 'original',
    disbursementDate: new Date().toISOString().split('T')[0],
  });

  // Summary computations
  const totalLoanAmount = loans.reduce((sum, l) => sum + l.amount, 0);
  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
  const totalMonthlyInterest = loans.reduce((sum, l) => sum + l.monthlyInterest, 0);

  // Loans with outstanding balance for repayment select
  const loansWithOutstanding = loans.filter(l => l.outstandingBalance > 0);

  // Borrowing compliance — group loan amounts by member
  const loansByMember = {};
  loans.forEach(loan => {
    loansByMember[loan.memberId] = (loansByMember[loan.memberId] ?? 0) + loan.amount;
  });
  const membersAtOrAbove = members.filter(m => (loansByMember[m.id] ?? 0) >= minimumBorrowingAmount);
  const membersBelowMin = members.filter(m => loansByMember[m.id] > 0 && loansByMember[m.id] < minimumBorrowingAmount);
  const membersNeverBorrowed = members.filter(m => !loansByMember[m.id]);

  const handleRepaymentChange = useCallback((e) => {
    const { name, value } = e.target;
    setRepaymentForm(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleLoanChange = useCallback((e) => {
    const { name, value } = e.target;
    setLoanForm(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleRepaymentSubmit = useCallback(async (e) => {
    e.preventDefault();
    try {
      await recordLoanRepayment({
        loanId: repaymentForm.loanId,
        principal_amount: repaymentForm.principalAmount,
        interest_amount: repaymentForm.interestAmount || 0,
        date: repaymentForm.date,
      }).unwrap();
      toast.success('Loan repayment recorded successfully');
      setShowRepaymentModal(false);
      setRepaymentForm({ loanId: '', principalAmount: '', interestAmount: '', date: new Date().toISOString().split('T')[0] });
    } catch (err) {
      toast.error(err?.data?.error ?? 'Failed to record repayment');
    }
  }, [repaymentForm, recordLoanRepayment]);

  const handleLoanSubmit = useCallback(async (e) => {
    e.preventDefault();
    try {
      await disburseLoan({
        member_id: parseInt(loanForm.memberId, 10),
        cycle_id: cycleId,
        loan_type: loanForm.loanType,
        amount: parseFloat(loanForm.amount),
        disbursed_date: loanForm.disbursementDate,
      }).unwrap();
      toast.success('Loan approved and disbursed successfully');
      setShowApproveLoanModal(false);
      setLoanForm({ memberId: '', amount: '', loanType: 'original', disbursementDate: new Date().toISOString().split('T')[0] });
    } catch (err) {
      toast.error(err?.data?.error ?? 'Failed to disburse loan');
    }
  }, [loanForm, disburseLoan, cycleId]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Loans Management</h1>
          <p className="text-gray-600 mt-1">Manage loan requests, disbursements, and repayments</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRepaymentModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Record Repayment
          </button>
          <button
            onClick={() => setShowApproveLoanModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Approve Loan
          </button>
        </div>
      </div>

      {/* Record Repayment Modal */}
      {showRepaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Record Loan Repayment</h2>
              <button
                onClick={() => setShowRepaymentModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleRepaymentSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Loan *
                </label>
                <select
                  name="loanId"
                  required
                  value={repaymentForm.loanId}
                  onChange={handleRepaymentChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose a member with outstanding loan...</option>
                  {loansWithOutstanding.map(loan => (
                    <option key={loan.id} value={loan.id}>
                      {loan.memberName} - Outstanding: K{loan.outstandingBalance.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Principal Repayment (K) *
                  </label>
                  <input
                    type="number"
                    name="principalAmount"
                    required
                    min="0"
                    step="0.01"
                    value={repaymentForm.principalAmount}
                    onChange={handleRepaymentChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Interest Repayment (K)
                  </label>
                  <input
                    type="number"
                    name="interestAmount"
                    min="0"
                    step="0.01"
                    value={repaymentForm.interestAmount}
                    onChange={handleRepaymentChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {repaymentForm.principalAmount && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-900">
                    Total Repayment: K{(parseFloat(repaymentForm.principalAmount || '0') + parseFloat(repaymentForm.interestAmount || '0')).toLocaleString()}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Repayment Date *
                </label>
                <input
                  type="date"
                  name="date"
                  required
                  value={repaymentForm.date}
                  onChange={handleRepaymentChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowRepaymentModal(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={repaying}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {repaying ? 'Recording...' : 'Record Repayment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Loan Modal */}
      {showApproveLoanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Approve & Disburse Loan</h2>
              <button
                onClick={() => setShowApproveLoanModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleLoanSubmit} className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>Note:</strong> Minimum borrowing requirement is K{minimumBorrowingAmount.toLocaleString()} per cycle
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Member *
                </label>
                <select
                  name="memberId"
                  required
                  value={loanForm.memberId}
                  onChange={handleLoanChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Choose a member...</option>
                  {members.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loan Type *
                </label>
                <select
                  name="loanType"
                  required
                  value={loanForm.loanType}
                  onChange={handleLoanChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="original">Original Loan</option>
                  <option value="top_up">Top-Up</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loan Amount (K) *
                </label>
                <input
                  type="number"
                  name="amount"
                  required
                  min="100"
                  step="0.01"
                  value={loanForm.amount}
                  onChange={handleLoanChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="20000"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Loan will accrue {(interestRate * 100).toFixed(0)}% compound monthly interest
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Disbursement Date *
                </label>
                <input
                  type="date"
                  name="disbursementDate"
                  required
                  value={loanForm.disbursementDate}
                  onChange={handleLoanChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Loan payout window: 4th - 5th of each month
                </p>
              </div>

              {loanForm.amount && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-purple-900 mb-2">
                    Loan Summary:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm text-purple-800">
                    <div>Principal Amount:</div>
                    <div className="font-semibold">K{parseFloat(loanForm.amount).toLocaleString()}</div>
                    <div>Monthly Interest ({(interestRate * 100).toFixed(0)}%):</div>
                    <div className="font-semibold">K{(parseFloat(loanForm.amount) * interestRate).toLocaleString()}</div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowApproveLoanModal(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disbursing}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {disbursing ? 'Disbursing...' : 'Approve & Disburse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <p className="text-blue-700 text-sm font-medium mb-2">Total Loans Disbursed</p>
          <p className="text-3xl font-bold text-blue-900">K{totalLoanAmount.toLocaleString()}</p>
          <p className="text-xs text-blue-600 mt-1">{loans.length} active loans</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-700 text-sm font-medium mb-2">Outstanding Balance</p>
          <p className="text-3xl font-bold text-red-900">K{totalOutstanding.toLocaleString()}</p>
          <p className="text-xs text-red-600 mt-1">
            {totalLoanAmount > 0 ? ((totalOutstanding / totalLoanAmount) * 100).toFixed(1) : '0.0'}% of total
          </p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <p className="text-purple-700 text-sm font-medium mb-2">Monthly Interest Due</p>
          <p className="text-3xl font-bold text-purple-900">K{totalMonthlyInterest.toLocaleString()}</p>
          <p className="text-xs text-purple-600 mt-1">{(interestRate * 100).toFixed(0)}% compound rate</p>
        </div>
      </div>

      {/* Active Loans Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Active Loans {cycle?.currentMonth ? `(Month ${cycle.currentMonth})` : ''}
          </h2>
          <button
            onClick={() => exportLoans(loans)}
            disabled={loans.length === 0}
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Disbursed Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Monthly Interest</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loansLoading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-400">Loading loans...</td>
                </tr>
              ) : loans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-400">No loans found for this cycle</td>
                </tr>
              ) : (
                loans.map((loan) => (
                  <tr key={loan.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{loan.memberName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        loan.loanType === 'original'  ? 'bg-blue-100 text-blue-800' :
                        loan.loanType === 'top_up'    ? 'bg-green-100 text-green-800' :
                                                        'bg-orange-100 text-orange-800'
                      }`}>
                        {loan.loanType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                      K{loan.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {loan.disbursedDate}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-red-600">
                      K{loan.outstandingBalance.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-purple-600">
                      K{loan.monthlyInterest.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        loan.status === 'repaid'     ? 'bg-gray-100 text-gray-600' :
                        loan.status === 'disbursed'  ? 'bg-green-100 text-green-800' :
                        loan.status === 'defaulted'  ? 'bg-red-100 text-red-800' :
                                                       'bg-yellow-100 text-yellow-800'
                      }`}>
                        {loan.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Borrowing Compliance */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Borrowing Compliance Overview {cycle?.currentMonth ? `(Month ${cycle.currentMonth})` : ''}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">Minimum Required Per Cycle</p>
            <p className="text-2xl font-bold text-gray-900">K{minimumBorrowingAmount.toLocaleString()}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm text-green-700 mb-2">At/Above Minimum</p>
            <p className="text-2xl font-bold text-green-900">{membersAtOrAbove.length} member{membersAtOrAbove.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-green-600 mt-1">
              {membersAtOrAbove.slice(0, 2).map(m => m.fullName).join(', ')}
              {membersAtOrAbove.length > 2 ? ` +${membersAtOrAbove.length - 2} more` : ''}
            </p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <p className="text-sm text-yellow-700 mb-2">Below Minimum</p>
            <p className="text-2xl font-bold text-yellow-900">{membersBelowMin.length} member{membersBelowMin.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-yellow-600 mt-1">
              {membersBelowMin.slice(0, 2).map(m => m.fullName).join(', ')}
              {membersBelowMin.length > 2 ? ` +${membersBelowMin.length - 2} more` : ''}
            </p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-blue-700 mb-2">Never Borrowed</p>
            <p className="text-2xl font-bold text-blue-900">{membersNeverBorrowed.length} member{membersNeverBorrowed.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-blue-600 mt-1">Still within cycle period</p>
          </div>
        </div>
      </div>
    </div>
  );
}

