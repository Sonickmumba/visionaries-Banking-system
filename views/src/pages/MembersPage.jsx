import { useState, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  useGetActiveCycleQuery,
  useGetMembersQuery,
  useEnrollMemberMutation,
  useUpdateMemberStatusMutation,
  useGetPendingMembersQuery,
  useApproveMemberMutation,
  usePayCommonInterestMutation,
  useEnforceCommonInterestMutation,
} from '../store/api.js';
import { exportMembers } from '../utils/csvExport.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const INITIAL_FORM = { fullName: '', email: '', phone: '', address: '' };
const INITIAL_CI_PAY = { amount: '', paymentDate: new Date().toISOString().split('T')[0] };
const TABS = ['Enrolled', 'Pending Approval'];

// ─── MembersPage ─────────────────────────────────────────────────────────────
export default function MembersPage() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: cycle } = useGetActiveCycleQuery();
  const cycleId = cycle?.id;
  const currentMonth = cycle?.currentMonth ?? 1;

  const { data: members = [], isLoading, error } = useGetMembersQuery(
    { cycleId },
    { skip: !cycleId }
  );

  const [enrollMember,           { isLoading: enrolling }]   = useEnrollMemberMutation();
  const [updateMemberStatus,     { isLoading: updating }]    = useUpdateMemberStatusMutation();
  const [approveMember,          { isLoading: approving }]   = useApproveMemberMutation();
  const [payCommonInterest,      { isLoading: payingCI }]    = usePayCommonInterestMutation();
  const [enforceCommonInterest,  { isLoading: enforcing }]   = useEnforceCommonInterestMutation();

  const { data: pendingUsers = [] } = useGetPendingMembersQuery();

  // ── Local state ───────────────────────────────────────────────────────────
  const [activeTab,         setActiveTab]         = useState('Enrolled');
  const [showCIPayModal,    setShowCIPayModal]     = useState(false);
  const [ciPayForm,         setCIPayForm]          = useState(INITIAL_CI_PAY);
  const [ciPayError,        setCIPayError]         = useState(null);
  const [searchTerm,        setSearchTerm]       = useState('');
  const [selectedMemberId,  setSelectedMemberId] = useState(null);
  const [showAddModal,      setShowAddModal]      = useState(false);
  const [formData,          setFormData]          = useState(INITIAL_FORM);
  const [formError,         setFormError]         = useState(null);
  const [enrolledMember,    setEnrolledMember]    = useState(null); // holds { name, email, tempPassword } after enroll
  const [approvingUserId,   setApprovingUserId]   = useState(null);
  const [approveError,      setApproveError]      = useState(null);

  // Derive selected member from list (defaults to first)
  const selectedMember = useMemo(
    () => members.find((m) => m.id === selectedMemberId) ?? members[0] ?? null,
    [members, selectedMemberId]
  );

  // Filtered list for search
  const filteredMembers = useMemo(
    () =>
      members.filter(
        (m) =>
          m.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.email.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [members, searchTerm]
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setFormError(null);
      if (!cycleId) return;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await enrollMember({
          full_name:   formData.fullName,
          email:       formData.email,
          phone:       formData.phone,
          address:     formData.address,
          cycle_id:    cycleId,
          joined_date: today,
        }).unwrap();
        setShowAddModal(false);
        setFormData(INITIAL_FORM);
        // If a brand-new account was created, surface the temp password to the admin
        if (result.temporaryPassword) {
          setEnrolledMember({
            name:          formData.fullName,
            email:         formData.email,
            tempPassword:  result.temporaryPassword,
          });
        }
      } catch (err) {
        setFormError(err?.data?.error ?? 'Failed to enroll member. Please try again.');
      }
    },
    [cycleId, formData, enrollMember]
  );

  const handleCloseModal = useCallback(() => {
    setShowAddModal(false);
    setFormError(null);
    setFormData(INITIAL_FORM);
  }, []);

  const handleDeactivate = useCallback(async () => {
    if (!selectedMember) return;
    const newStatus = selectedMember.status === 'active' ? 'inactive' : 'active';
    try {
      await updateMemberStatus({ id: selectedMember.id, status: newStatus }).unwrap();
    } catch (err) {
      alert(err?.data?.error ?? 'Failed to update member status.');
    }
  }, [selectedMember, updateMemberStatus]);

  const handleApprove = useCallback(
    async (userId) => {
      if (!cycleId) return;
      setApprovingUserId(userId);
      setApproveError(null);
      try {
        const today = new Date().toISOString().slice(0, 10);
        await approveMember({ userId, cycle_id: cycleId, joined_date: today }).unwrap();
      } catch (err) {
        setApproveError(err?.data?.error ?? 'Failed to approve member.');
      } finally {
        setApprovingUserId(null);
      }
    },
    [cycleId, approveMember]
  );

  // ── Common Interest payment handlers ──────────────────────────────────────
  const handleCIPaySubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!cycleId || !selectedMember) return;
      setCIPayError(null);
      try {
        await payCommonInterest({
          cycleId,
          member_id:    selectedMember.id,
          month:        currentMonth,
          amount:       parseFloat(ciPayForm.amount),
          payment_date: ciPayForm.paymentDate,
        }).unwrap();
        toast.success('Common interest payment recorded');
        setShowCIPayModal(false);
        setCIPayForm(INITIAL_CI_PAY);
      } catch (err) {
        setCIPayError(err?.data?.error ?? 'Failed to record payment.');
      }
    },
    [cycleId, currentMonth, selectedMember, ciPayForm, payCommonInterest]
  );

  const handleEnforceCI = useCallback(async () => {
    if (!cycleId) return;
    try {
      const result = await enforceCommonInterest({ cycleId, month: currentMonth }).unwrap();
      toast.success(
        result?.converted > 0
          ? `${result.converted} member(s) had unpaid common interest converted to loans`
          : 'No unpaid common interest found for this month'
      );
    } catch (err) {
      toast.error(err?.data?.error ?? 'Failed to enforce common interest.');
    }
  }, [cycleId, currentMonth, enforceCommonInterest]);

  // ── Loading / error ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-gray-500 text-lg">Loading members…</div>
      </div>
    );
  }

  if (error) {
    const message = error?.data?.error ?? 'Failed to load members.';
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
          <h1 className="text-3xl font-bold text-gray-900">Members</h1>
          <p className="text-gray-600 mt-1">Manage member profiles and enrollment</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add Member
        </button>
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full">
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Add New Member</h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Server-side error */}
              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  name="fullName"
                  required
                  value={formData.fullName}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+260-97-123-4567"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="City, Country"
                />
              </div>

              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={enrolling}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enrolling}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {enrolling ? 'Adding…' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Temporary Password Modal — shown once after enrolling a brand-new member */}
      {enrolledMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">Member Enrolled</h2>
            </div>

            <p className="text-gray-600 text-sm">
              A new account was created for <strong>{enrolledMember.name}</strong>. Share the credentials below with the member so they can log in and change their password.
            </p>

            <div className="bg-gray-50 rounded-lg p-4 space-y-2 border border-gray-200">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Email</p>
                <p className="font-mono text-gray-900">{enrolledMember.email}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Temporary Password</p>
                <p className="font-mono text-lg font-semibold text-blue-700 tracking-widest">
                  {enrolledMember.tempPassword}
                </p>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-sm">
              This password is shown <strong>only once</strong>. Please write it down or copy it before closing.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigator.clipboard?.writeText(enrolledMember.tempPassword)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
              >
                Copy Password
              </button>
              <button
                onClick={() => setEnrolledMember(null)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {tab === 'Pending Approval' && pendingUsers.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                  {pendingUsers.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Enrolled members panel ────────────────────────────────────────── */}
      {activeTab === 'Enrolled' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Members List */}
          <div className="lg:col-span-1 bg-white rounded-lg border border-gray-200">
            <div className="p-4 border-b border-gray-200 space-y-3">
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={() => exportMembers(members)}
              disabled={members.length === 0}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Members CSV
            </button>
          </div>

          <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">
                {searchTerm ? 'No members match your search.' : 'No members enrolled yet.'}
              </p>
            ) : (
              filteredMembers.map((member) => (
                <div
                  key={member.id}
                  onClick={() => setSelectedMemberId(member.id)}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedMember?.id === member.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{member.fullName}</p>
                      <p className="text-sm text-gray-600">{member.email}</p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {member.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Member Details */}
        <div className="lg:col-span-2 space-y-6">
          {selectedMember ? (
            <>
              {/* Profile Card */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedMember.fullName}</h2>
                    <p className="text-gray-600 mt-1">Member ID: #{selectedMember.id}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                      Edit
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={updating}
                      className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                    >
                      {updating
                        ? '…'
                        : selectedMember.status === 'active'
                        ? 'Deactivate'
                        : 'Reactivate'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium text-gray-900">{selectedMember.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p className="font-medium text-gray-900">{selectedMember.phone ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="font-medium text-gray-900">{selectedMember.address ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Joined Date</p>
                    <p className="font-medium text-gray-900">{selectedMember.joinedDate}</p>
                  </div>
                </div>
              </div>

              {/* Financial Summary — uses balance columns joined by getMembers */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">
                    Financial Summary (Month {currentMonth} — Current)
                  </h3>
                  {/* Enforce button: admin converts ALL unpaid CI for this month into loans */}
                  {members.some((m) => m.commonInterestDue > 0) && (
                    <button
                      onClick={handleEnforceCI}
                      disabled={enforcing}
                      className="text-sm px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {enforcing ? 'Enforcing…' : 'Enforce Unpaid CI → Loans'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-green-700">Accumulated Savings</p>
                    <p className="text-xl font-bold text-green-900">
                      K{selectedMember.accumulatedSavings.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-blue-700">Outstanding Loan</p>
                    <p className="text-xl font-bold text-blue-900">
                      K{selectedMember.outstandingLoan.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm text-purple-700">Common Interest Due</p>
                    <p className="text-xl font-bold text-purple-900">
                      K{selectedMember.commonInterestDue.toLocaleString()}
                    </p>
                    {selectedMember.commonInterestDue > 0 && (
                      <button
                        onClick={() => { setCIPayError(null); setCIPayForm(INITIAL_CI_PAY); setShowCIPayModal(true); }}
                        className="mt-2 text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
                      >
                        Record Payment
                      </button>
                    )}
                  </div>
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <p className="text-sm text-orange-700">Cumulative Borrowing</p>
                    <p className="text-xl font-bold text-orange-900">
                      K{selectedMember.cumulativeBorrowing.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Compliance Status</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {selectedMember.complianceStatus.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Social Fund</p>
                    <p className={`font-medium ${selectedMember.socialFundPaid ? 'text-green-600' : 'text-red-500'}`}>
                      {selectedMember.socialFundPaid ? '✅ Paid' : '❌ Unpaid'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Membership</p>
                    <p className={`font-medium ${selectedMember.membershipFeePaid ? 'text-green-600' : 'text-red-500'}`}>
                      {selectedMember.membershipFeePaid ? '✅ Paid' : '❌ Unpaid'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
              Select a member from the list to view details.
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Pending Approval panel ────────────────────────────────────────── */}
      {activeTab === 'Pending Approval' && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Pending Member Approvals</h2>
            <p className="text-sm text-gray-500 mt-1">
              These users registered but haven't been enrolled in the active cycle yet. Approve to activate their account and add them to the current cycle.
            </p>
          </div>

          {approveError && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
              {approveError}
            </div>
          )}

          {pendingUsers.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              No pending approvals — all registered users are enrolled.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-700">Name</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-700">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-700">Phone</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-700">Registered</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{u.fullName}</td>
                    <td className="px-6 py-4 text-gray-600">{u.email}</td>
                    <td className="px-6 py-4 text-gray-600">{u.phone ?? '—'}</td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        disabled={approving && approvingUserId === u.id || !cycleId}
                        onClick={() => handleApprove(u.id)}
                        className="px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
                      >
                        {approving && approvingUserId === u.id ? 'Approving…' : 'Approve & Enroll'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Common Interest Payment Modal ─────────────────────────────────── */}
      {showCIPayModal && selectedMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Record Common Interest Payment</h2>
              <button onClick={() => setShowCIPayModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <form onSubmit={handleCIPaySubmit} className="p-6 space-y-4">
              <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-800">
                <p className="font-medium">{selectedMember.fullName}</p>
                <p>Amount due: <span className="font-bold">K{selectedMember.commonInterestDue.toLocaleString()}</span></p>
                <p className="mt-1 text-xs text-purple-600">
                  Payment window: 28th of current month – 3rd of next month.
                  Payments after the 3rd incur a K100 late penalty.
                </p>
              </div>

              {ciPayError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
                  {ciPayError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount (K) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  max={selectedMember.commonInterestDue}
                  step="0.01"
                  value={ciPayForm.amount}
                  onChange={(e) => setCIPayForm((p) => ({ ...p, amount: e.target.value }))}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder={`Max K${selectedMember.commonInterestDue}`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={ciPayForm.paymentDate}
                  onChange={(e) => setCIPayForm((p) => ({ ...p, paymentDate: e.target.value }))}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCIPayModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payingCI}
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                >
                  {payingCI ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
