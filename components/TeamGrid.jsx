'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, DAYS, fromKey, MONTHS_SHORT, monthLabel, rangeKeys, startOfMonth, startOfWeek } from '@/lib/dates';
import { computeStatus, STATUS } from '@/lib/status';
import { useAttendance } from '@/lib/hooks';
import { useApp } from './AppShell';
import { Legend } from './ui';

const WINDOW = 14;

// Trainees × continuous dates. Moves across months and years with the arrows.
export default function TeamGrid({ trainees, trainerNames, onOpenDate }) {
  const { settings, now } = useApp();
  const [start, setStart] = useState(() => startOfWeek(now.date));
  const end = addDays(start, WINDOW - 1);
  const keys = useMemo(() => rangeKeys(start, end), [start, end]);
  const ids = useMemo(() => trainees.map((t) => t.id), [trainees]);
  const { byTrainee, loading, reload } = useAttendance(ids, start, end);
  const label = monthLabel(start) === monthLabel(end) ? monthLabel(start) : `${monthLabel(start)} – ${monthLabel(end)}`;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setStart(addMonths(start, -1))} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <h2 className="text-center text-lg font-bold tracking-tight sm:text-xl">{label}</h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setStart(addMonths(start, 1))} aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={14} />Previous</button>
          <button className="btn-primary btn-sm" onClick={() => setStart(startOfWeek(now.date))}>Today</button>
          <button className="btn-secondary btn-sm" onClick={() => setStart(addDays(start, 7))}>Next<ChevronRight size={14} /></button>
          <button className="btn-ghost btn-sm" onClick={() => setStart(startOfMonth(now.date))}>Current Month</button>
        </div>
      </div>
      <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[170px] border-b border-r border-slate-200 bg-white px-4 py-2 text-left text-xs font-semibold text-slate-500">Trainee</th>
              {keys.map((k) => {
                const d = fromKey(k);
                const isToday = k === now.date;
                const clickable = onOpenDate && k <= now.date;
                return (
                  <th key={k} onClick={clickable ? () => onOpenDate(k, reload) : undefined} title={clickable ? 'Open register for this date' : undefined}
                    className={`min-w-[58px] border-b border-slate-200 px-1 py-2 text-center ${isToday ? 'bg-ink-800 text-white' : 'bg-white'} ${clickable ? 'cursor-pointer hover:bg-ink-50' : ''}`}>
                    <div className={`font-display text-base font-bold leading-none ${isToday ? '' : 'text-ink-900'}`}>{d.getUTCDate()}</div>
                    <div className={`mt-0.5 text-[10px] font-semibold ${isToday ? 'text-ink-100' : 'text-slate-400'}`}>
                      {d.getUTCDate() === 1 ? MONTHS_SHORT[d.getUTCMonth()] : DAYS[d.getUTCDay()].slice(0, 3)}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {trainees.map((t) => (
              <tr key={t.id}>
                <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-4 py-2">
                  <Link href={`/timeline?trainee=${t.id}`} className="font-semibold text-slate-800 hover:text-ink-700 hover:underline">{t.name}</Link>
                  <div className="text-[11px] text-slate-400">{[t.employee_code, trainerNames?.[t.trainer_id]].filter(Boolean).join(' · ')}</div>
                </td>
                {keys.map((k) => {
                  const info = computeStatus({ dateKey: k, settings, record: byTrainee[t.id]?.[k], now, trainee: t });
                  const m = STATUS[info.status];
                  return (
                    <td key={k} className={`border-b border-slate-100 p-1 text-center ${k === now.date ? 'bg-ink-50' : ''}`}>
                      <span title={`${m.short}${info.note ? ` · ${info.note}` : ''}`} className={`mx-auto flex h-9 w-11 items-center justify-center rounded-lg text-xs font-bold ${m.chip}`}>
                        {m.letter || ''}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:justify-between sm:px-5">
        <Legend />
        <span>P Present · A Absent · HD Half day · H Holiday · W Week off · ! Not marked{onOpenDate ? ' · Click a date to mark' : ''}</span>
      </div>
    </div>
  );
}
