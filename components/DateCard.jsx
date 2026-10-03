'use client';
import { DAYS, MONTHS_SHORT, fmtTime, fromKey } from '@/lib/dates';
import { STATUS, countsText } from '@/lib/status';

export const CARD_W = 176;
export const CARD_GAP = 12;

function Head({ d, isToday }) {
  const firstOfMonth = d.getUTCDate() === 1;
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[34px] font-extrabold leading-none tracking-tight text-ink-900">{d.getUTCDate()}</span>
          <span className="text-xs font-bold text-slate-500">{MONTHS_SHORT[d.getUTCMonth()].toUpperCase()}{firstOfMonth ? ` ${d.getUTCFullYear()}` : ''}</span>
        </div>
        <div className="mt-1 text-xs font-medium text-slate-500">{DAYS[d.getUTCDay()]}</div>
      </div>
      {isToday && <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-bold text-white">Today</span>}
    </div>
  );
}

function Shell({ dateKey, m, isToday, children }) {
  const d = fromKey(dateKey);
  return (
    <div data-date={dateKey}
      className={`relative flex h-[216px] w-[176px] shrink-0 snap-start flex-col rounded-2xl border p-4 ${m.card} ${isToday ? 'border-2 border-ink-800 shadow-[0_10px_30px_-12px_rgba(29,39,80,0.45)]' : ''}`}>
      {d.getUTCDate() === 1 && <span className="absolute -top-px left-4 right-4 h-[3px] rounded-b bg-ink-800" aria-hidden="true" />}
      <Head d={d} isToday={isToday} />
      <div className="mt-auto">{children}</div>
    </div>
  );
}

const actionClass = (danger) => `mt-3 w-full rounded-lg px-3 py-2 text-xs font-bold transition-colors ${danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-ink-800 text-white hover:bg-ink-900'}`;

// One trainee on one date
export default function DateCard({ dateKey, info, isToday, tz, onOpen }) {
  const m = STATUS[info.status];
  const rec = info.record;
  return (
    <Shell dateKey={dateKey} m={m} isToday={isToday}>
      <div className="text-lg leading-none" aria-hidden="true">{m.icon}</div>
      <div className={`mt-1.5 text-[13px] font-extrabold leading-tight tracking-wide ${m.text}`}>{m.label}</div>
      {info.note && <div className="mt-0.5 truncate text-[11px] text-slate-500">{info.note}</div>}
      {rec && <div className="mt-0.5 text-[11px] text-slate-500">Updated: {fmtTime(rec.marked_at, tz)}{rec.is_late && <span className="ml-1 font-semibold text-orange-600">Late</span>}</div>}
      {onOpen && info.canMark && <button onClick={() => onOpen(dateKey)} className={actionClass(info.status === 'not_filled')}>Mark Attendance</button>}
      {onOpen && rec && <button onClick={() => onOpen(dateKey)} className="mt-2 text-xs font-semibold text-ink-600 hover:underline">Change</button>}
    </Shell>
  );
}

// A whole group of trainees on one date
export function GroupDateCard({ dateKey, info, isToday, onOpen }) {
  const m = STATUS[info.status];
  const summary = countsText(info.counts || {});
  return (
    <Shell dateKey={dateKey} m={m} isToday={isToday}>
      <div className="text-lg leading-none" aria-hidden="true">{m.icon}</div>
      <div className={`mt-1.5 text-[13px] font-extrabold leading-tight tracking-wide ${m.text}`}>{m.label}</div>
      {info.note && <div className="mt-0.5 text-[11px] text-slate-500">{info.note}</div>}
      {info.total > 0 && info.status !== 'upcoming' && (
        <div className="mt-0.5 text-[11px] text-slate-600">
          {info.unmarked > 0 ? <span className="font-semibold text-red-600">{info.unmarked} of {info.total} not marked</span> : `${info.total} trainees`}
          {summary && <div className="truncate text-slate-500">{summary}</div>}
        </div>
      )}
      {onOpen && info.canMark && (
        <button onClick={() => onOpen(dateKey)} className={info.unmarked > 0 ? actionClass(info.status === 'not_filled') : 'mt-2 text-left text-xs font-semibold text-ink-600 hover:underline'}>
          {info.unmarked > 0 ? 'Mark Attendance' : 'View / Change'}
        </button>
      )}
    </Shell>
  );
}
