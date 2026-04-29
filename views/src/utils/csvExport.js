/**
 * CSV export utilities.
 * Pure functions — no dependencies. Works in any modern browser via Blob + anchor.
 */

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const val = String(row[c.key] ?? '').replace(/"/g, '""');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val}"`
          : val;
      })
      .join(',')
  );
  return [header, ...body].join('\r\n');
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportMembers(members) {
  const columns = [
    { key: 'id',                  label: 'ID' },
    { key: 'fullName',            label: 'Full Name' },
    { key: 'email',               label: 'Email' },
    { key: 'phone',               label: 'Phone' },
    { key: 'address',             label: 'Address' },
    { key: 'status',              label: 'Status' },
    { key: 'joinedDate',          label: 'Joined Date' },
    { key: 'accumulatedSavings',  label: 'Accumulated Savings (K)' },
    { key: 'outstandingLoan',     label: 'Outstanding Loan (K)' },
    { key: 'cumulativeBorrowing', label: 'Cumulative Borrowing (K)' },
    { key: 'complianceStatus',    label: 'Compliance Status' },
  ];
  const csv      = toCsv(members, columns);
  const datePart = new Date().toISOString().slice(0, 10);
  downloadCsv(csv, `members-${datePart}.csv`);
}

export function exportSavings(savings) {
  const columns = [
    { key: 'memberName',        label: 'Member' },
    { key: 'month',             label: 'Month' },
    { key: 'principalDeposit',  label: 'Principal Deposit (K)' },
    { key: 'totalPrincipal',    label: 'Total Principal (K)' },
    { key: 'savingsInterest',   label: 'Interest (K)' },
    { key: 'accumulatedSavings', label: 'Accumulated Savings (K)' },
  ];
  const csv      = toCsv(savings, columns);
  const datePart = new Date().toISOString().slice(0, 10);
  downloadCsv(csv, `savings-${datePart}.csv`);
}

export function exportTransactions(transactions) {
  const columns = [
    { key: 'memberName',  label: 'Member' },
    { key: 'month',       label: 'Month' },
    { key: 'type',        label: 'Type' },
    { key: 'amount',      label: 'Amount (K)' },
  ];
  const csv      = toCsv(transactions, columns);
  const datePart = new Date().toISOString().slice(0, 10);
  downloadCsv(csv, `transactions-${datePart}.csv`);
}

export function exportLoans(loans) {
  const columns = [
    { key: 'memberName',         label: 'Member' },
    { key: 'loanType',           label: 'Type' },
    { key: 'amount',             label: 'Amount (K)' },
    { key: 'disbursedDate',      label: 'Disbursed Date' },
    { key: 'outstandingBalance', label: 'Outstanding (K)' },
    { key: 'monthlyInterest',    label: 'Monthly Interest (K)' },
    { key: 'status',             label: 'Status' },
  ];
  const csv      = toCsv(loans, columns);
  const datePart = new Date().toISOString().slice(0, 10);
  downloadCsv(csv, `loans-${datePart}.csv`);
}
