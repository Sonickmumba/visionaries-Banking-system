import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  DollarSign,
  TrendingUp,
  CreditCard,
  User,
  RefreshCw,
} from 'lucide-react';
import {
  useGetActiveCycleQuery,
  useGetApprovalStatsQuery,
  useGetApprovalsQuery,
  useApproveSavingsDeclarationMutation,
  useRejectSavingsDeclarationMutation,
  useApproveLoanRequestMutation,
  useRejectLoanRequestMutation,
  useApproveLoanRepaymentMutation,
  useRejectLoanRepaymentMutation,
} from '../store/api';

// Map UI tab values to the API type parameter
const TAB_TO_TYPE = {
  all:           undefined,
  savings:       'savings_declaration',
  loan_requests: 'loan_request',
  repayments:    'loan_repayment',
};

function formatTimeAgo(dateString) {
  const diffMs   = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60)  return `${diffMins}m ago`;
  const diffHrs  = Math.floor(diffMins / 60);
  if (diffHrs  < 24)  return `${diffHrs}h ago`;
  return formatDate(dateString);
}

function formatCurrency(amount) {
  return `K${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatusBadge({ status }) {
  if (status === 'pending') {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
        <Clock className="w-3 h-3 mr-1 inline" />Pending
      </Badge>
    );
  }
  if (status === 'approved') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <CheckCircle2 className="w-3 h-3 mr-1 inline" />Approved
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">
        <XCircle className="w-3 h-3 mr-1 inline" />Rejected
      </Badge>
    );
  }
  return <Badge>{status}</Badge>;
}

function ApprovalCard({ approval, onView }) {
  const isRepayment  = approval.approval_type === 'loan_repayment';

  const typeConfig = {
    savings_declaration: { icon: DollarSign,  bg: 'bg-blue-100',   colour: 'text-blue-600',   label: 'Savings Deposit' },
    loan_request:        { icon: TrendingUp,  bg: 'bg-purple-100', colour: 'text-purple-600', label: 'Loan Request' },
    loan_repayment:      { icon: CreditCard,  bg: 'bg-green-100',  colour: 'text-green-600',  label: 'Loan Repayment' },
  };
  const tc = typeConfig[approval.approval_type] || typeConfig.loan_repayment;
  const Icon = tc.icon;
  return (
    <Card className="p-4 md:p-6 hover:shadow-md transition-shadow">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className={'w-10 h-10 rounded-full flex items-center justify-center shrink-0 ' + tc.bg}>
                <Icon className={'w-5 h-5 ' + tc.colour} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{tc.label}</h3>
                <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                  <span>{approval.member_name}</span>
                </div>
              </div>
            </div>
            <StatusBadge status={approval.status} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-gray-500">Amount</p>
              <p className="font-semibold">{formatCurrency(approval.amount)}</p>
            </div>
            <div>
              <p className="text-gray-500">Submitted</p>
              <p className="font-medium">{formatTimeAgo(approval.submitted_at)}</p>
            </div>
            {isRepayment && approval.details?.reference_number && (
              <div>
                <p className="text-gray-500">Reference</p>
                <p className="font-medium font-mono text-xs">{approval.details.reference_number}</p>
              </div>
            )}
          </div>
        </div>

        <Button size="sm" variant="outline" onClick={() => onView(approval)}>
          <FileText className="w-4 h-4 mr-2" />
          Review
        </Button>
      </div>
    </Card>
  );
}

export default function ApprovalsPage() {
  const { user } = useSelector((s) => s.auth);
  const isAdmin  = user?.role === 'admin' || user?.role === 'super_admin';

  const [activeTab,        setActiveTab]        = useState('all');
  const [statusFilter,     setStatusFilter]     = useState('pending');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [rejectionReason,  setRejectionReason]  = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: cycle } = useGetActiveCycleQuery();
  const cycleId         = cycle?.id;

  const { data: stats = {} } = useGetApprovalStatsQuery(
    { cycleId },
    { skip: !cycleId }
  );

  const { data: approvals = [], isFetching, refetch } = useGetApprovalsQuery(
    { cycleId, type: TAB_TO_TYPE[activeTab], status: statusFilter },
    { skip: !cycleId }
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const [approveSavings,  { isLoading: approvingSavings }]  = useApproveSavingsDeclarationMutation();
  const [rejectSavings,   { isLoading: rejectingSavings }]  = useRejectSavingsDeclarationMutation();
  const [approveLoanReq,  { isLoading: approvingLoanReq }]  = useApproveLoanRequestMutation();
  const [rejectLoanReq,   { isLoading: rejectingLoanReq }]  = useRejectLoanRequestMutation();
  const [approveLoan,     { isLoading: approvingLoan }]      = useApproveLoanRepaymentMutation();
  const [rejectLoan,      { isLoading: rejectingLoan }]      = useRejectLoanRepaymentMutation();

  const isActionLoading = approvingSavings || rejectingSavings || approvingLoanReq || rejectingLoanReq || approvingLoan || rejectingLoan;

  // ── Derived stats ────────────────────────────────────────────────────────
  const pendingSavings  = stats.pending_savings       ?? 0;
  const pendingLoanReqs = stats.pending_loan_requests ?? 0;
  const pendingRepay    = stats.pending_repayments    ?? 0;
  const pendingTotal    = pendingSavings + pendingLoanReqs + pendingRepay;

  function tabLabel(tab) {
    const labels = { all: 'All', savings: 'Savings', loan_requests: 'Loan Requests', repayments: 'Repayments' };
    if (statusFilter !== 'pending') return labels[tab];
    const counts = { all: pendingTotal, savings: pendingSavings, loan_requests: pendingLoanReqs, repayments: pendingRepay };
    return `${labels[tab]} (${counts[tab]})`;
  }

  // ── Action handlers ──────────────────────────────────────────────────────
  async function handleApprove(approval) {
    try {
      if (approval.approval_type === 'savings_declaration') {
        await approveSavings(approval.id).unwrap();
      } else if (approval.approval_type === 'loan_request') {
        await approveLoanReq(approval.id).unwrap();
      } else {
        await approveLoan(approval.id).unwrap();
      }
      toast.success(`Approved for ${approval.member_name}`);
      setSelectedApproval(null);
    } catch (err) {
      toast.error(err?.data?.error ?? 'Approval failed');
    }
  }

  async function handleReject(approval) {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    try {
      if (approval.approval_type === 'savings_declaration') {
        await rejectSavings({ approvalId: approval.id, reason: rejectionReason }).unwrap();
      } else if (approval.approval_type === 'loan_request') {
        await rejectLoanReq({ approvalId: approval.id, reason: rejectionReason }).unwrap();
      } else {
        await rejectLoan({ approvalId: approval.id, reason: rejectionReason }).unwrap();
      }
      toast.success(`Rejected for ${approval.member_name}`);
      setSelectedApproval(null);
      setShowRejectDialog(false);
      setRejectionReason('');
    } catch (err) {
      toast.error(err?.data?.error ?? 'Rejection failed');
    }
  }

  function closeRejectDialog() {
    setShowRejectDialog(false);
    setRejectionReason('');
  }

  function openFileView(fileId) {
    window.open(`/api/files/${fileId}/view`, '_blank', 'noopener,noreferrer');
  }

  // ── Access guard ─────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-gray-600">Only administrators can access the approvals page.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-600 mt-1">Review and approve pending transactions</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingTotal > 0 && (
            <Badge className="text-base px-4 py-2 bg-yellow-100 text-yellow-800 border-yellow-200">
              {pendingTotal} Pending
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={refetch} disabled={isFetching} title="Refresh">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Savings</p>
              <p className="text-2xl font-bold mt-1">{pendingSavings}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Loan Requests</p>
              <p className="text-2xl font-bold mt-1">{pendingLoanReqs}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Repayments</p>
              <p className="text-2xl font-bold mt-1">{pendingRepay}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Pending</p>
              <p className="text-2xl font-bold mt-1">{pendingTotal}</p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Status filter ────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
      </div>

      {/* ── Tabs + list ──────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {['all', 'savings', 'loan_requests', 'repayments'].map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tabLabel(tab)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-6 space-y-4">
          {isFetching ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : approvals.length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No {statusFilter} approvals</h3>
              <p className="text-gray-600">Nothing to display for this filter.</p>
            </Card>
          ) : (
            approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onView={setSelectedApproval}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* ── Detail dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!selectedApproval} onOpenChange={() => setSelectedApproval(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedApproval && (() => {
            const a        = selectedApproval;
            const isLoanRq = a.approval_type === 'loan_request';
            const isRepay  = a.approval_type === 'loan_repayment';
            const details  = a.details ?? {};

            const typeConfig = {
              savings_declaration: { icon: DollarSign,  colour: 'text-blue-600',   label: 'Savings Deposit' },
              loan_request:        { icon: TrendingUp,  colour: 'text-purple-600', label: 'Loan Request' },
              loan_repayment:      { icon: CreditCard,  colour: 'text-green-600',  label: 'Loan Repayment' },
            };
            const tc = typeConfig[a.approval_type] || typeConfig.loan_repayment;
            const TcIcon = tc.icon;

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <TcIcon className={'w-5 h-5 ' + tc.colour} />
                    {tc.label}
                  </DialogTitle>
                  <DialogDescription>
                    Review the details before approving or rejecting
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {/* Member */}
                  <section className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <h4 className="text-sm font-semibold text-gray-700">Member</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-500">Name: </span><span className="font-medium">{a.member_name}</span></div>
                      <div><span className="text-gray-500">Email: </span><span className="font-medium">{a.member_email}</span></div>
                      <div><span className="text-gray-500">Phone: </span><span className="font-medium">{a.member_phone ?? '—'}</span></div>
                      <div><span className="text-gray-500">Status: </span><StatusBadge status={a.status} /></div>
                    </div>
                  </section>

                  {/* Transaction */}
                  <section className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <h4 className="text-sm font-semibold text-gray-700">Transaction</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Amount: </span>
                        <span className="font-semibold text-base">{formatCurrency(a.amount)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Submitted: </span>
                        <span className="font-medium">{formatDateTime(a.submitted_at)}</span>
                      </div>
                      {details.month && (
                        <div><span className="text-gray-500">Month: </span><span className="font-medium">{details.month}</span></div>
                      )}
                      {isLoanRq && (
                        <div>
                          <span className="text-gray-500">Requested Amount: </span>
                          <span className="font-semibold">{formatCurrency(details.loan_request ?? a.amount)}</span>
                        </div>
                      )}
                      {isRepay && (
                        <>
                          <div><span className="text-gray-500">Reference: </span><span className="font-medium font-mono text-xs">{details.reference_number ?? '—'}</span></div>
                          <div>
                            <span className="text-gray-500">Method: </span>
                            <span className="font-medium capitalize">{(details.payment_method ?? '').replace(/_/g, ' ')}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Loan Type: </span>
                            <span className="font-medium capitalize">{details.loan_type ?? '—'}</span>
                          </div>
                          {details.loan_amount && (
                            <div>
                              <span className="text-gray-500">Loan Amount: </span>
                              <span className="font-medium">{formatCurrency(details.loan_amount)}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </section>

                  {/* Payment proof */}
                  {details.file_name && (
                    <section className="bg-gray-50 p-4 rounded-lg space-y-2">
                      <h4 className="text-sm font-semibold text-gray-700">Payment Proof</h4>
                      <div className="flex items-center gap-3 p-3 bg-white border rounded-lg">
                        <FileText className="w-8 h-8 text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{details.file_name}</p>
                          <p className="text-xs text-gray-400">{details.file_type}</p>
                        </div>
                        {details.file_id && (
                          <Button size="sm" variant="outline" onClick={() => openFileView(details.file_id)}>
                            View File
                          </Button>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Rejection reason (for already-rejected) */}
                  {a.status === 'rejected' && a.notes && (
                    <section className="bg-red-50 border border-red-200 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-red-700 mb-1">Rejection Reason</h4>
                      <p className="text-sm text-red-600">{a.notes}</p>
                    </section>
                  )}
                </div>

                <DialogFooter className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedApproval(null)}
                    className="sm:mr-auto"
                  >
                    Close
                  </Button>
                  {a.status === 'pending' && (
                    <>
                      <Button
                        variant="destructive"
                        onClick={() => setShowRejectDialog(true)}
                        disabled={isActionLoading}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                      <Button
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(a)}
                        disabled={isActionLoading}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {isActionLoading ? 'Processing…' : 'Approve'}
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Reject dialog ────────────────────────────────────────────────── */}
      <Dialog open={showRejectDialog} onOpenChange={closeRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Transaction</DialogTitle>
            <DialogDescription>
              Provide a reason. The member will be able to see this.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rejection-reason">Reason *</Label>
            <Textarea
              id="rejection-reason"
              placeholder="e.g. Payment proof is unclear, amount does not match receipt…"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="mt-2"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRejectDialog}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isActionLoading || !rejectionReason.trim()}
              onClick={() => selectedApproval && handleReject(selectedApproval)}
            >
              {isActionLoading ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
