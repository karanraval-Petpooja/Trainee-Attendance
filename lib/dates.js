// All dates are handled as 'YYYY-MM-DD' keys and computed in UTC, so there are
// no timezone drifts. Nothing here is tied to a particular month or year.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n) => String(n).padStart(2, '0');

export function toKey(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function fromKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(k, n) {
  const d = fromKey(k);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
}
export function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86400000);
}
export function rangeKeys(start, end) {
  const out = [];
  if (!start || !end || start > end) return out;
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}
export const minKey = (a, b) => (a < b ? a : b);
export const maxKey = (a, b) => (a > b ? a : b);

export const dayOfWeek = (k) => fromKey(k).getUTCDay(); // 0 = Sunday … 6 = Saturday
export const nthWeekdayOfMonth = (k) => Math.ceil(fromKey(k).getUTCDate() / 7);
export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); // handles leap years

export const startOfMonth = (k) => `${k.slice(0, 8)}01`;
export function endOfMonth(k) {
  const d = fromKey(k);
  return toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
// Returns the first day of the month n months away
export function addMonths(k, n) {
  const d = fromKey(k);
  return toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
export function startOfWeek(k) {
  return addDays(k, -((dayOfWeek(k) + 6) % 7)); // weeks start Monday
}
export const startOfYear = (k) => `${k.slice(0, 4)}-01-01`;
export const endOfYear = (k) => `${k.slice(0, 4)}-12-31`;

// Current date/time in the organisation's timezone
export function nowInTz(tz = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}:${g('second')}` };
}

export const fmtDay = (k) => (k ? DAYS[dayOfWeek(k)] : '—');
export function fmtShort(k) {
  if (!k) return '—';
  const d = fromKey(k);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}
export function fmtMedium(k) {
  if (!k) return '—';
  const d = fromKey(k);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtLong(k) {
  if (!k) return '—';
  const d = fromKey(k);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function monthLabel(k) {
  if (!k) return '—';
  const d = fromKey(k);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtTime(iso, tz) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
}
export function fmtDateTime(iso, tz) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
export function fmtClock(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
