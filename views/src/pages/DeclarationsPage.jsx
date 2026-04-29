import { useState, useMemo } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  FileText,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
  Users,
  DollarSign,
  TrendingUp,
  CreditCard,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import {
  useGetActiveCycleQuery,
  useGetDeclarationsQuery,
  useGetDeclarationStatsQuery,
  useGetMissingDeclarationsQuery,
  useSubmitDeclarationMutation,
  useGetMembersQuery,
  useGetPenaltiesQuery,
  useGetLoansQuery,
} from '../store/api';

// --- Helpers ----------------------------------------------------------------

function fmt(amount) {
  return 'K' + Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ApprovalHint({ text }) {
  return (
    <p className="flex items-center gap-1 text-xs text-amber-700 mt-1">
      <Clock className="w-3 h-3 shrink-0" />
      {text}
    </p>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending:   { cls: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Pending' },
    approved:  { cls: 'bg-green-100 text-green-800 border-green-200',   label: 'Approved' },
    rejected:  { cls: 'bg-red-100 text-red-800 border-red-200',         label: 'Rejected' },
    submitted: { cls: 'bg-blue-100 text-blue-800 border-blue-200',      label: 'Submitted' },
    processed: { cls: 'bg-purple-100 text-purple-800 border-purple-200', label: 'Processed' },
  };
  const s = map[status] || { cls: 'bg-gray-100 text-gray-700', label: status };
  return <Badge className={s.cls}>{s.label}</Badge>;
}

function penaltyCls(status) {
  const map = {
    assessed:          'bg-yellow-100 text-yellow-800',
    paid:              'bg-green-100 text-green-800',
    waived:            'bg-gray-100 text-gray-700',
    converted_to_loan: 'bg-orange-100 text-orange-800',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

function exportCSV(rows, filename) {
  if (!rows.length) { toast.error('Nothing to export'); return; }
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => JSON.stringify(r[h] != null ? r[h] : '')).join(','));
  const blob = new Blob([[headers.join(','), ...body].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// --- Submit Declaration Modal -----------------------------------------------

function SubmitDeclarationModal({ cycleId, members, declarations, onClose }) {
  const [form, setForm] = useState({
    member_id:           '',
    savings_amount:      '',
    loan_request:        '',
    principal_repayment: '',
    interest_repayment:  '',
    loan_id:             '',
    payment_method:      'cash',
  });

  const [submitDeclaration, { isLoading }] = useSubmitDeclarationMutation();

  // ── Derive per-member constraints from already-fetched declarations ───────────────
  const memberDeclsThisMonth = form.member_id
    ? declarations.filter((d) => String(d.member_id) === String(form.member_id))
    : [];

  // Savings: once per member per month
  const alreadySaved = memberDeclsThisMonth.some((d) => parseFloat(d.savings_amount) > 0);

  // Loan request: no stacking open (pending/approved) requests in this cycle
  const hasOpenLoanRequest = memberDeclsThisMonth.some(
    (d) => parseFloat(d.loan_request) > 0 && ['pending', 'approved'].includes(d.status)
  );

  // Fetch active loans for the selected member so they can pick which loan to repay
  const hasRepayment = parseFloat(form.principal_repayment) > 0 || parseFloat(form.interest_repayment) > 0;
  const { data: memberLoans = [] } = useGetLoansQuery(
    { cycleId, member_id: form.member_id || undefined, status: 'disbursed' },
    { skip: !cycleId || !form.member_id || !hasRepayment }
  );

  // Compute which approvals will be generated (for user feedback)
  const willApprove = useMemo(() => {
    const items = [];
    if (!alreadySaved && parseFloat(form.savings_amount)      > 0) items.push({ icon: DollarSign,  label: 'Savings deposit',  colour: 'text-blue-600' });
    if (!hasOpenLoanRequest && parseFloat(form.loan_request)  > 0) items.push({ icon: TrendingUp,  label: 'Loan request',     colour: 'text-purple-600' });
    if (parseFloat(form.principal_repayment) > 0 || parseFloat(form.interest_repayment) > 0)
      items.push({ icon: CreditCard, label: 'Loan repayment', colour: 'text-green-600' });
    return items;
  }, [form.savings_amount, form.loan_request, form.principal_repayment, form.interest_repayment, alreadySaved, hasOpenLoanRequest]);

  function handleChange(e) {
    const { name, value } = e.target;
    // Reset all amounts when member changes so constraints are cleanly re-evaluated
    if (name === 'member_id') {
      setForm({
        member_id:           value,
        savings_amount:      '',
        loan_request:        '',
        principal_repayment: '',
        interest_repayment:  '',
        loan_id:             '',
        payment_method:      'cash',
      });
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.member_id) { toast.error('Please select a member'); return; }
    if (hasRepayment && !form.loan_id) {
      toast.error('Please select the loan you are repaying');
      return;
    }

    const payload = {
      member_id:           parseInt(form.member_id, 10),
      cycle_id:            cycleId,
      savings_amount:      parseFloat(form.savings_amount)      || 0,
      loan_request:        parseFloat(form.loan_request)        || 0,
      principal_repayment: parseFloat(form.principal_repayment) || 0,
      interest_repayment:  parseFloat(form.interest_repayment)  || 0,
      ...(hasRepayment && form.loan_id && { loan_id: parseInt(form.loan_id, 10) }),
      ...(hasRepayment && { payment_method: form.payment_method }),
    };

    try {
      const result = await submitDeclaration(payload).unwrap();
      const approvalCount = willApprove.length;
      const isPending = result.declaration && result.declaration.status === 'pending';
      toast.success(isPending
        ? `Declaration submitted — ${approvalCount} item${approvalCount > 1 ? 's' : ''} pending admin approval`
        : 'Declaration submitted successfully');
      onClose();
    } catch (err) {
      toast.error((err && err.data && err.data.error) || 'Failed to submit declaration');
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit Monthly Declaration</DialogTitle>
          <DialogDescription>
            Fill in any combination of items. Each non-zero item creates a separate approval
            request for the admin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          {/* Window banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
            <strong>Declaration Window:</strong> 28th of current month to 3rd of next month.
            Submissions outside this window are accepted but flagged.
          </div>

          {/* Member */}
          <div className="space-y-1">
            <Label htmlFor="member_id">Member *</Label>
            <select
              id="member_id" name="member_id" required
              value={form.member_id} onChange={handleChange}
              className={inputCls}
            >
              <option value="">Choose a member...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </div>

          {/* ── Section 1: Savings ───────────────────────────────────────── */}
          <div className={`border rounded-xl p-4 space-y-3 ${alreadySaved ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className={`w-4 h-4 ${alreadySaved ? 'text-gray-400' : 'text-blue-600'}`} />
                <h4 className="text-sm font-semibold text-gray-800">Savings Deposit</h4>
              </div>
              {alreadySaved && (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <CheckCircle2 className="w-3 h-3" /> Saved this month
                </span>
              )}
            </div>
            {alreadySaved ? (
              <p className="text-sm text-gray-500">
                This member has already submitted a savings deposit this month.
                Only one savings entry is allowed per month.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="savings_amount">Amount (K)</Label>
                <input
                  id="savings_amount" type="number" name="savings_amount" min="0" step="0.01"
                  value={form.savings_amount} onChange={handleChange} placeholder="0.00"
                  className={inputCls}
                />
                {parseFloat(form.savings_amount) > 0 && (
                  <ApprovalHint text="Will create a savings deposit approval" />
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: Loan Request ──────────────────────────────────── */}
          <div className={`border rounded-xl p-4 space-y-3 ${hasOpenLoanRequest ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className={`w-4 h-4 ${hasOpenLoanRequest ? 'text-gray-400' : 'text-purple-600'}`} />
                <h4 className="text-sm font-semibold text-gray-800">Loan Request</h4>
              </div>
              <span className="text-xs text-gray-400">Any time this cycle</span>
            </div>
            {hasOpenLoanRequest ? (
              <p className="text-sm text-gray-500">
                This member already has a pending or approved loan request this cycle.
                It must be resolved before a new one can be submitted.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="loan_request">Amount Requested (K)</Label>
                <input
                  id="loan_request" type="number" name="loan_request" min="0" step="0.01"
                  value={form.loan_request} onChange={handleChange} placeholder="0.00"
                  className={inputCls}
                />
                {parseFloat(form.loan_request) > 0 && (
                  <ApprovalHint text="Will create a loan request approval — loan is disbursed after admin approves" />
                )}
              </div>
            )}
          </div>

          {/* ── Section 3: Loan Repayment ────────────────────────────────── */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-green-600" />
              <h4 className="text-sm font-semibold text-gray-800">Loan Repayment</h4>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="principal_repayment">Principal (K)</Label>
                <input
                  id="principal_repayment" type="number" name="principal_repayment" min="0" step="0.01"
                  value={form.principal_repayment} onChange={handleChange} placeholder="0.00"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="interest_repayment">Interest (K)</Label>
                <input
                  id="interest_repayment" type="number" name="interest_repayment" min="0" step="0.01"
                  value={form.interest_repayment} onChange={handleChange} placeholder="0.00"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Loan selector — only shown when repayment is entered */}
            {hasRepayment && (
              <div className="space-y-1">
                <Label htmlFor="loan_id">Loan Being Repaid *</Label>
                {memberLoans.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No active loans found for this member.
                  </p>
                ) : (
                  <select
                    id="loan_id" name="loan_id" required={hasRepayment}
                    value={form.loan_id} onChange={handleChange}
                    className={inputCls}
                  >
                    <option value="">Select a loan...</option>
                    {memberLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.loanType} loan — {fmt(l.amount)} — Balance: {fmt(l.outstandingBalance)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Payment method */}
            {hasRepayment && (
              <div className="space-y-1">
                <Label htmlFor="payment_method">Payment Method</Label>
                <select
                  id="payment_method" name="payment_method"
                  value={form.payment_method} onChange={handleChange}
                  className={inputCls}
                >
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
            )}

            {hasRepayment && (
              <ApprovalHint text="Will create a loan repayment approval — balance is reduced after admin approves" />
            )}
          </div>

          {/* Summary of what will go to approval */}
          {willApprove.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-800 mb-2">
                {willApprove.length} approval request{willApprove.length > 1 ? 's' : ''} will be created:
              </p>
              <ul className="space-y-1">
                {willApprove.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-amber-700">
                    <item.icon className={'w-3.5 h-3.5 ' + item.colour} />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading || (hasRepayment && !form.loan_id && memberLoans.length > 0)}>
              {isLoading ? 'Submitting...' : 'Submit Declaration'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Page -------------------------------------------------------------------

export function DeclarationsPage() {
  const { user } = useSelector((s) => s.auth);
  const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

  const [showModal, setShowModal]       = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: cycle } = useGetActiveCycleQuery();
  const cycleId         = cycle && cycle.id;
  const currentMonth    = cycle && cycle.currentMonth;

  const {
    data: declarations = [],
    isFetching: declFetching,
    refetch: refetchDecl,
  } = useGetDeclarationsQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId || !currentMonth }
  );

  const { data: stats = {} } = useGetDeclarationStatsQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId || !currentMonth }
  );

  const { data: missingMembers = [] } = useGetMissingDeclarationsQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId || !currentMonth }
  );

  const {
    data: penalties = [],
    isFetching: penFetching,
    refetch: refetchPen,
  } = useGetPenaltiesQuery(
    { cycleId, month: currentMonth },
    { skip: !cycleId || !currentMonth }
  );

  const { data: members = [] } = useGetMembersQuery(
    { cycleId, status: 'active' },
    { skip: !cycleId }
  );

  const filteredDecl = statusFilter === 'all'
    ? declarations
    : declarations.filter((d) => d.status === statusFilter);

  const totalMembers      = parseInt(stats.total_members      || 0, 10);
  const totalDeclarations = parseInt(stats.total_declarations || 0, 10);
  const pendingCount      = parseInt(stats.pending            || 0, 10);
  const approvedCount     = parseInt(stats.approved           || 0, 10);
  const missingCount      = parseInt(stats.missing_declarations != null
    ? stats.missing_declarations
    : missingMembers.length, 10);

  function handleRefresh() { refetchDecl(); refetchPen(); }

  const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected', 'submitted'];

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Declarations & Penalties</h1>
          <p className="text-gray-500 mt-1">Month {currentMonth} · {(cycle && cycle.name) || ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}
            disabled={declFetching || penFetching} title="Refresh">
            <RefreshCw className={'w-4 h-4 ' + (declFetching || penFetching ? 'animate-spin' : '')} />
          </Button>
          {isAdmin && (
            <Button onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4 mr-2" />Submit Declaration
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Submitted</p>
          <p className="text-2xl font-bold mt-1">{totalDeclarations}</p>
          <p className="text-xs text-gray-400">of {totalMembers} members</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Pending Approval</p>
          <p className="text-2xl font-bold mt-1 text-yellow-600">{pendingCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Approved</p>
          <p className="text-2xl font-bold mt-1 text-green-600">{approvedCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Missing</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{missingCount}</p>
        </Card>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-start gap-3">
        <FileText className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base font-semibold text-blue-900">Declaration Workflow</h3>
          <p className="text-sm text-blue-800 mt-1">
            Members declare between the <strong>28th and 3rd</strong>. Declarations with savings
            go to the admin approval queue — funds are committed only after approval.
            Missing declarations incur a <strong>K100 penalty</strong>.
          </p>
        </div>
      </div>

      {/* Missing alert */}
      {missingMembers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {missingMembers.length} member{missingMembers.length > 1 ? 's have' : ' has'} not declared this month
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {missingMembers.map((m) => m.full_name).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* Pending approval callout */}
      {isAdmin && pendingCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-yellow-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-yellow-900">
              {pendingCount} declaration{pendingCount > 1 ? 's' : ''} pending your review
            </p>
            <p className="text-xs text-yellow-700 mt-0.5">
              Visit the Approvals page to approve or reject. Savings are committed only after approval.
            </p>
          </div>
        </div>
      )}

      {/* Declarations table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900 mr-auto">
            Month {currentMonth} Declarations
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={'px-3 py-1 rounded-full text-xs font-medium border transition-colors ' +
                  (statusFilter === s
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50')}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button
              onClick={() => exportCSV(filteredDecl.map((d) => ({
                member: d.member_name, month: d.month,
                savings: d.savings_amount, loan_req: d.loan_request,
                principal: d.principal_repayment, interest: d.interest_repayment,
                status: d.status,
              })), 'declarations-month-' + currentMonth + '.csv')}
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-blue-600 border border-blue-300 rounded-full hover:bg-blue-50"
            >
              <Download className="w-3 h-3" />Export
            </button>
          </div>
        </div>

        {declFetching ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : filteredDecl.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No declarations found</p>
            <p className="text-gray-400 text-sm mt-1">
              {statusFilter === 'all' ? 'None submitted this month yet.' : 'No ' + statusFilter + ' declarations.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Month</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Savings</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Loan Req.</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Repayment</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  {isAdmin && (
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDecl.map((dec) => (
                  <tr key={dec.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 whitespace-nowrap font-medium text-gray-900">{dec.member_name}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800 font-medium">
                        Month {dec.month}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {new Date(dec.submitted_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-right font-medium">
                      {parseFloat(dec.savings_amount) > 0
                        ? fmt(dec.savings_amount)
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-right font-medium">
                      {parseFloat(dec.loan_request) > 0
                        ? fmt(dec.loan_request)
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-right font-medium">
                      {parseFloat(dec.principal_repayment) + parseFloat(dec.interest_repayment) > 0
                        ? fmt(parseFloat(dec.principal_repayment) + parseFloat(dec.interest_repayment))
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-center">
                      <StatusBadge status={dec.status} />
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-xs text-gray-500 max-w-xs truncate">
                        {dec.rejection_reason
                          ? <span className="text-red-600">{dec.rejection_reason}</span>
                          : dec.reviewed_by_name
                            ? <span className="text-green-600">by {dec.reviewed_by_name}</span>
                            : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Penalties table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">Month {currentMonth} Penalties</h2>
            {penalties.filter((p) => p.status === 'assessed').length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                {penalties.filter((p) => p.status === 'assessed').length} unpaid
              </span>
            )}
          </div>
          <button
            onClick={() => exportCSV(penalties.map((p) => ({
              member: p.member_name, month: p.month, type: p.penalty_type,
              amount: p.amount, reason: p.reason, status: p.status,
            })), 'penalties-month-' + currentMonth + '.csv')}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-blue-600 border border-blue-300 rounded-full hover:bg-blue-50"
          >
            <Download className="w-3 h-3" />Export
          </button>
        </div>

        {penFetching ? (
          <div className="space-y-2 p-4">
            {[1, 2].map((i) => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : penalties.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="font-medium text-gray-900">No penalties this month</p>
            <p className="text-sm text-gray-500 mt-1">All members declared on time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Member</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Month</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {penalties.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 whitespace-nowrap font-medium text-gray-900">{p.member_name}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-medium">
                        Month {p.month}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800 font-medium">
                        {(p.penalty_type || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-right font-semibold text-red-600">
                      {fmt(p.amount)}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{p.reason}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-center">
                      <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + penaltyCls(p.status)}>
                        {(p.status || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submit modal */}
      {showModal && (
        <SubmitDeclarationModal
          cycleId={cycleId}
          currentMonth={currentMonth}
          members={members}
          declarations={declarations}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export default DeclarationsPage;
