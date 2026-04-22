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
