/**
 * Date formatting utilities.
 *
 * PostgreSQL DATE columns are returned as ISO strings like "2026-04-28T22:00:00.000Z"
 * (UTC midnight = local midnight in UTC+2). Slicing to "YYYY-MM-DD" and parsing
 * as a local date avoids timezone-shift display bugs.
 */

/**
 * Format a date-only value (DATE column or YYYY-MM-DD string) as "28 Apr 2026".
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a timestamp value (TIMESTAMPTZ column) as "28 Apr 2026, 10:00 PM".
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
