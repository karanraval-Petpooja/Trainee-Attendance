'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Coffee, HelpCircle, LayoutGrid, List, X } from 'lucide-react';
import {
  addMonths, DAYS, endOfMonth, fmtTime, fromKey, MONTHS, MONTHS_SHORT, rangeKeys, startOfMonth,
} from '@/lib/dates';
import { computeStatus, countsText, groupStatus, STATUS, streaks, summarize, weekOffReason } from '@/lib/status';
import { useAttendance } from '@/lib/hooks';
import { useApp } from './AppShell';
import { RegisterModal } from './Register';
import { StatCard } from './ui';

// Short code shown in the middle of a day cell
const CODE = {
  present: 'P', absent: 'A', half_day: 'HD', holiday: 'H', week_off: 'WO',
  not_filled: 'NM', pending: '…', marked: '✓', upcoming: '', not_joined: '', exited: '–', other_trainer: '↗', none: '',
};

// Cell colours (soft fills like the HR app)
const CELL = {
  present: 'bg-emerald-50 text-emerald-800',
  marked: 'bg-emerald-50 text-emerald-800',
  absent: 'bg-rose-50 text-rose-700',
  half_day: 'bg-orange-50 text-orange-700',
  holiday: 'bg-fuchsia-50 text-fuchsia-700',
  week_off: 'bg-slate-100 text-slate-600',
  not_filled: 'bg-red-50 text-red-700',
  pending: 'bg-white text-ink-700',
  upcoming: 'bg-white text-slate-300',
  not_joined: 'bg-white text-slate-300',
  exited: 'bg-slate-50 text-slate-400',
  other_trainer: 'bg-slate-50 text-slate-400',
  none: 'bg-white text-slate-300',
};

const LEGEND = [
  ['P', 'Present', CELL.present], ['A', 'Absent', CELL.absent], ['HD', 'Half Day', CELL.half_day],
  ['H', 'Holiday', CELL.holiday], ['WO', 'Week Off', CELL.week_off], ['NM', 'Not Marked (deadline passed)', CELL.not_filled],
  ['…', 'Pending (before deadline)', 'bg-white text-ink-700 ring-1 ring-ink-200'], ['–', 'Not in training (handed over / left)', CELL.exited], ['↗', 'Batch with another trainer that day', CELL.other_trainer],
];

const shortMonth = (k) => { const d = fromKey(k); return `${MONTHS_SHORT[d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(2)}`; };
const fullMonth = (k) => { const d = fromKey(k); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/**
 * Month calendar for one trainee (single) or a batch.
 * Overview tab = month summary; Day Wise tab = calendar grid or list.
 * Tap a day to mark / change attendance (when editable).
 */
export default function MonthCalendar({ trainees, single = false, editable = false, trainerNames }) {
  const { settings, now, tz } = useApp();
  const [month, setMonth] = useState(startOfMonth(now.date));
  const [tab, setTab] = useState('day');
  const [layout, setLayout] = useState('grid');
  const [openDate, setOpenDate] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const touchX = useRef(null);

  const start = month;
  const end = endOfMonth(month);
  const days = useMemo(() => rangeKeys(start, end), [start, end]);
  const ids = useMemo(() => trainees.map((t) => t.id), [trainees]);
  // For streaks in Overview we look back a little further for a single trainee
  const { byTrainee, loading, reload } = useAttendance(ids, start, end);
  const trainee = single ? trainees[0] : null;

  const infoFor = (k) => (single
    ? computeStatus({ dateKey: k, settings, record: byTrainee[trainee?.id]?.[k], now, trainee })
    : groupStatus({ dateKey: k, settings, trainees, recordsByTrainee: byTrainee, now }));

  const canOpen = (k, info) => editable && k <= now.date && !weekOffReason(k, settings)
    && (single ? !['not_joined', 'exited', 'other_trainer'].includes(info.status) : info.status !== 'none');

  const go = (n) => setMonth(addMonths(month, n));
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  const leading = fromKey(start).getUTCDay(); // calendar starts on Sunday

  return (
    <div className="panel overflow-hidden">
      {/* Month switcher */}
      <div className="bg-gradient-to-br from-amber-50 via-white to-rose-50 px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto flex max-w-md items-center justify-between rounded-2xl border border-slate-200 bg-white/80 px-2 py-2 shadow-sm backdrop-blur">
          <button onClick={() => go(-1)} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100" aria-label="Previous month"><ChevronLeft size={22} /></button>
          <div className="text-center">
            <div className="font-display text-xl font-bold text-ink-900" aria-live="polite">{shortMonth(month)}</div>
            <div className="text-[11px] text-slate-400">{fullMonth(month)}</div>
          </div>
          <button onClick={() => go(1)} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100" aria-label="Next month"><ChevronRight size={22} /></button>
        </div>
        {month !== startOfMonth(now.date) && (
          <div className="mt-2 text-center"><button onClick={() => setMonth(startOfMonth(now.date))} className="text-xs font-semibold text-ink-700 hover:underline">Back to this month</button></div>
        )}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-slate-200" role="tablist">
        {[['overview', 'Overview'], ['day', 'Day Wise']].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
            className={`relative py-3 text-sm font-semibold ${tab === v ? 'text-ink-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
            {tab === v && <span className="absolute inset-x-6 bottom-0 h-[3px] rounded-t bg-ink-800" />}
          </button>
        ))}
      </div>

      {tab === 'day' && (
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* Toolbar: help + grid/list toggle */}
          <div className="flex items-center justify-between px-4 py-3 sm:px-5">
            <button onClick={() => setShowHelp((s) => !s)} className="rounded-full p-1 text-ink-600 hover:bg-ink-50" aria-label="What do the codes mean?"><HelpCircle size={24} /></button>
            <div className="flex rounded-full border border-slate-200 p-0.5">
              <button onClick={() => setLayout('grid')} aria-pressed={layout === 'grid'} aria-label="Calendar view"
                className={`rounded-full px-4 py-1.5 ${layout === 'grid' ? 'bg-ink-800 text-white' : 'text-slate-500'}`}><LayoutGrid size={18} /></button>
              <button onClick={() => setLayout('list')} aria-pressed={layout === 'list'} aria-label="List view"
                className={`rounded-full px-4 py-1.5 ${layout === 'list' ? 'bg-ink-800 text-white' : 'text-slate-500'}`}><List size={18} /></button>
            </div>
          </div>

          {showHelp && (
            <div className="mx-4 mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:mx-5">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
                What the codes mean
                <button onClick={() => setShowHelp(false)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                {LEGEND.map(([c, l, cls]) => (
                  <div key={c} className="flex items-center gap-2"><span className={`inline-flex h-6 w-9 items-center justify-center rounded font-bold ${cls}`}>{c}</span><span className="text-slate-600">{l}</span></div>
                ))}
              </div>
              {!single && <p className="mt-2 text-xs text-slate-500">For a batch, the middle shows how many were present (e.g. 9/10) and the corner shows absents or unmarked.</p>}
              {editable && <p className="mt-1 text-xs text-slate-500">Tap a day to mark or change attendance.</p>}
            </div>
          )}

          {layout === 'grid' ? (
            <div className={`border-t border-slate-200 ${loading ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold text-slate-500">
                {DAYS.map((d) => <div key={d} className="py-1.5">{d.slice(0, 3)}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px bg-slate-200">
                {Array.from({ length: leading }).map((_, i) => <div key={`b${i}`} className="bg-white" />)}
                {days.map((k) => {
                  const info = infoFor(k);
                  const clickable = canOpen(k, info);
                  const isToday = k === now.date;
                  const rec = single ? info.record : null;
                  let center = CODE[info.status];
                  let corner = '';
                  if (!single && info.total) {
                    const c = info.counts || {};
                    if (info.status === 'marked') center = `${c.present + (c.half_day || 0)}/${info.total}`;
                    else if (info.status === 'not_filled' || info.status === 'pending') center = `${info.unmarked}${info.status === 'not_filled' ? ' NM' : ' left'}`;
                    corner = [c.absent ? `${c.absent}A` : '', c.half_day ? `${c.half_day}HD` : ''].filter(Boolean).join(' ');
                  }
                  if (single && rec?.is_late) corner = 'Late';
                  const Tag = clickable ? 'button' : 'div';
                  return (
                    <Tag key={k} onClick={clickable ? () => setOpenDate(k) : undefined}
                      title={`${fromKey(k).getUTCDate()} ${fullMonth(k)} · ${STATUS[info.status]?.short || ''}${info.note ? ` · ${info.note}` : ''}`}
                      className={`relative flex h-[76px] flex-col p-1.5 text-left sm:h-24 sm:p-2 ${CELL[info.status] || 'bg-white'} ${clickable ? 'cursor-pointer transition hover:brightness-95' : ''} ${isToday ? 'z-10 outline outline-2 outline-ink-800' : ''}`}>
                      <span className={`text-sm font-semibold sm:text-base ${isToday ? 'text-ink-900' : 'text-slate-700'}`}>{fromKey(k).getUTCDate()}</span>
                      <span className="flex flex-1 items-center justify-center gap-1 text-sm font-bold sm:text-lg">
                        {center}
                        {info.status === 'week_off' && <Coffee size={14} className="opacity-70" aria-hidden="true" />}
                      </span>
                      <span className="absolute bottom-1 right-1.5 text-[10px] font-semibold text-slate-400 sm:text-[11px]">{corner}</span>
                    </Tag>
                  );
                })}
              </div>
            </div>
          ) : (
            <ul className={`divide-y divide-slate-100 border-t border-slate-200 ${loading ? 'opacity-60' : ''}`}>
              {days.map((k) => {
                const info = infoFor(k);
                const clickable = canOpen(k, info);
                const m = STATUS[info.status];
                const d = fromKey(k);
                const detail = single
                  ? (info.record ? `Marked ${fmtTime(info.record.marked_at, tz)}${info.record.is_late ? ' (late)' : ''}` : info.note || '')
                  : (info.status === 'week_off' ? info.note : info.total ? `${info.total - (info.unmarked || 0)}/${info.total} marked${countsText(info.counts) ? ` · ${countsText(info.counts)}` : ''}` : '');
                return (
                  <li key={k} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${k === now.date ? 'bg-ink-50/60' : ''}`}>
                    <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl ${CELL[info.status] || 'bg-slate-50'}`}>
                      <span className="text-base font-bold leading-none">{d.getUTCDate()}</span>
                      <span className="text-[10px] font-semibold opacity-70">{DAYS[d.getUTCDay()].slice(0, 3)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold ${m.text}`}>{m.short}{k === now.date ? ' · Today' : ''}</div>
                      {detail && <div className="truncate text-xs text-slate-500">{detail}</div>}
                    </div>
                    {clickable && (
                      <button onClick={() => setOpenDate(k)} className={`btn-sm btn ${['not_filled', 'pending'].includes(info.status) ? 'bg-ink-800 text-white hover:bg-ink-900' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                        {['not_filled', 'pending'].includes(info.status) ? 'Mark' : 'Change'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <Overview month={month} trainees={trainees} single={single} byTrainee={byTrainee} trainerNames={trainerNames} />
      )}

      {openDate && (
        <RegisterModal date={openDate} trainees={trainees} trainerNames={trainerNames}
          onClose={() => setOpenDate(null)} onSaved={reload} />
      )}
    </div>
  );
}

function Overview({ month, trainees, single, byTrainee, trainerNames }) {
  const { settings, now } = useApp();
  const end = endOfMonth(month);
  const rows = trainees.map((t) => ({
    t,
    s: summarize({ start: month, end, settings, records: byTrainee[t.id] || {}, now, trainee: t }),
  }));
  const tot = rows.reduce((a, { s }) => {
    ['present', 'absent', 'half_day', 'holiday', 'not_filled', 'pending'].forEach((k) => { a[k] = (a[k] || 0) + s[k]; });
    return a;
  }, {});
  const weekOffs = rangeKeys(month, end).filter((k) => weekOffReason(k, settings)).length;
  const denom = (tot.present || 0) + (tot.absent || 0) + (tot.half_day || 0) + (tot.not_filled || 0);
  const pct = denom ? Math.round((((tot.present || 0) + (tot.half_day || 0) / 2) * 1000) / denom) / 10 : null;
  const st = single && trainees[0] ? streaks({ settings, records: byTrainee[trainees[0].id] || {}, now, trainee: trainees[0], lookback: 31 }) : null;
  const bar = [['present', 'bg-emerald-500'], ['half_day', 'bg-orange-400'], ['holiday', 'bg-fuchsia-400'], ['absent', 'bg-rose-500'], ['not_filled', 'bg-red-700']];
  const barTotal = bar.reduce((n, [k]) => n + (tot[k] || 0), 0);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="font-display text-5xl font-extrabold tracking-tight text-ink-900">{pct === null ? '—' : `${pct}%`}</div>
        <div className="text-sm text-slate-500">{single ? 'attendance this month' : `batch attendance · ${trainees.length} trainees`}</div>
      </div>
      {barTotal > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {bar.map(([k, cls]) => tot[k] > 0 && <div key={k} className={cls} style={{ width: `${(tot[k] / barTotal) * 100}%` }} title={`${tot[k]} ${STATUS[k].short}`} />)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Present" value={tot.present || 0} tone="green" />
        <StatCard label="Absent" value={tot.absent || 0} tone="red" />
        <StatCard label="Half Day" value={tot.half_day || 0} tone="amber" />
        <StatCard label="Holiday" value={tot.holiday || 0} tone="amber" />
        <StatCard label="Week Off" value={weekOffs} tone="sky" hint="days this month" />
        <StatCard label="Not Marked" value={tot.not_filled || 0} tone="orange" />
      </div>
      {st && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Present streak" value={st.presentStreak} tone="green" hint="working days in a row" />
          <StatCard label="Absent streak" value={st.absentStreak} tone={st.absentStreak ? 'red' : 'slate'} hint="working days in a row" />
        </div>
      )}
      {!single && rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Trainee</th>{trainerNames && <th>Trainer</th>}<th>%</th><th>P</th><th>A</th><th>HD</th><th>H</th><th>NM</th></tr></thead>
              <tbody>
                {rows.map(({ t, s }) => (
                  <tr key={t.id}>
                    <td className="font-semibold text-slate-800">{t.name}</td>
                    {trainerNames && <td className="text-slate-500">{trainerNames[t.trainer_id] || '—'}</td>}
                    <td className="font-bold">{s.percentage === null ? '—' : `${s.percentage}%`}</td>
                    <td>{s.present}</td><td>{s.absent}</td><td>{s.half_day}</td><td>{s.holiday}</td>
                    <td className={s.not_filled ? 'font-bold text-red-600' : ''}>{s.not_filled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
