/**
 * Date/time helpers.
 *
 * Rule for the whole app: the API speaks UTC ISO strings, the UI renders in the
 * viewer's local zone, and the *composed* zone is displayed alongside so a user
 * scheduling from another timezone can see what they originally picked.
 */

export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Convert the value of an `<input type="datetime-local">` — which is a naive
 * wall-clock string with no zone — into an absolute UTC instant.
 *
 * `new Date('2026-03-14T09:30')` is interpreted by the browser in local time,
 * which is exactly the semantic the picker implies.
 */
export function localInputToUtcIso(value: string): string {
  return new Date(value).toISOString();
}

/** Value for a datetime-local input, `minutesFromNow` in the future. */
export function datetimeLocalValue(minutesFromNow = 0): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  // toISOString() is UTC, so subtract the offset to get local wall-clock.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Compact local timestamp: `2026-08-31 02:40`.
 *
 * Deliberately ISO-shaped rather than "Aug 31, 2026, 2:40 AM". It is five
 * characters shorter (which matters in a fixed-width monospace column), it
 * sorts the way it reads, and 24h time removes the AM/PM ambiguity that bites
 * people scheduling near midnight. The human-friendly "3 days ago" sits
 * underneath it in the table.
 *
 * Rendered in the viewer's local zone; the row shows the composing zone
 * alongside whenever the two differ.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** "in 4 min" / "2 h ago" — cheap relative time without a date library. */
export function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';

  const deltaSeconds = Math.round((target - Date.now()) / 1000);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let value = deltaSeconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

/** Truncate for table cells without breaking layout on a long subject. */
export const truncate = (value: string, max = 60): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export { formatDateTime as formatDate };
