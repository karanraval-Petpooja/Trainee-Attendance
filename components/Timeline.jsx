'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarSearch, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { sb } from '@/lib/supabase';
import {
  addDays, addMonths, diffDays, fmtMedium, monthLabel, rangeKeys, startOfMonth, startOfWeek,
} from '@/lib/dates';
import { computeStatus, groupStatus } from '@/lib/status';
import DateCard, { CARD_GAP, CARD_W, GroupDateCard } from './DateCard';
import { RegisterModal } from './Register';
import { useApp } from './AppShell';
import { Legend } from './ui';

const STEP = CARD_W + CARD_GAP;
const CHUNK = 28; // days added when the user scrolls near either end
const PAD = 4;

/**
 * Continuous date-wise attendance timeline.
 * - single: one trainee's status per date
 * - group: summary of all given trainees per date (e.g. a trainer's batch)
 * Dates are generated from real calendar arithmetic and extend forever in both
 * directions as the user scrolls — across month and year boundaries.
 */
export default function Timeline({ trainees, single = false, editable = false, trainerNames, onChange }) {
  const { settings, now, tz } = useApp();
  const today = now.date;
  const [range, setRange] = useState(() => ({ start: addDays(today, -CHUNK), end: addDays(today, CHUNK) }));
  const [custom, setCustom] = useState(null);
  const [customDraft, setCustomDraft] = useState({ start: startOfMonth(today), end: today });
  const [showCustom, setShowCustom] = useState(false);
  const [customError, setCustomError] = useState('');
  const [records, setRecords] = useState({});
  const [visibleKey, setVisibleKey] = useState(today);
  const [openDate, setOpenDate] = useState(null);
  const [version, setVersion] = useState(0);
  const idKey = trainees.map((t) => t.id).join(',');

  const scroller = useRef(null);
  const pendingShift = useRef(0);
  const pendingJump = useRef({ key: today, align: 'center', smooth: false });
  const extending = useRef(false);

  const keys = useMemo(() => rangeKeys(range.start, range.end), [range]);

  // Load attendance for whatever range is on screen → records[traineeId][date]
  useEffect(() => {
    if (!idKey) { setRecords({}); return undefined; }
    let alive = true;
    (async () => {
      const ids = idKey.split(',');
      const next = {};
      for (let c = 0; c < ids.length; c += 150) {
        for (let from = 0; ; from += 1000) {
          const { data } = await sb().from('attendance').select('*').in('trainee_id', ids.slice(c, c + 150))
            .gte('attendance_date', range.start).lte('attendance_date', range.end).range(from, from + 999);
          (data || []).forEach((r) => { (next[r.trainee_id] ||= {})[r.attendance_date] = r; });
          if (!data || data.length < 1000) break;
        }
      }
      if (alive) setRecords(next);
    })();
    return () => { alive = false; };
  }, [idKey, range.start, range.end, version]);

  const scrollToIndex = useCallback((idx, align = 'start', smooth = true) => {
    const el = scroller.current;
    if (!el) return;
    const base = PAD + idx * STEP;
    const left = align === 'center' ? base - (el.clientWidth - CARD_W) / 2 : base - PAD;
    el.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Keep the viewport steady after prepending dates; perform any queued jump
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pendingShift.current) {
      el.scrollLeft += pendingShift.current * STEP;
      pendingShift.current = 0;
    }
    if (pendingJump.current) {
      const { key, align, smooth } = pendingJump.current;
      const idx = keys.indexOf(key);
      if (idx >= 0) {
        pendingJump.current = null;
        scrollToIndex(idx, align, smooth);
      }
    }
    extending.current = false;
  }, [keys, scrollToIndex]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const leftIdx = Math.max(0, Math.min(keys.length - 1, Math.round((el.scrollLeft - PAD) / STEP)));
    setVisibleKey(keys[leftIdx]);
    if (custom || extending.current) return;
    if (el.scrollLeft < STEP * 3) {
      extending.current = true;
      pendingShift.current = CHUNK;
      setRange((r) => ({ ...r, start: addDays(r.start, -CHUNK) }));
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - STEP * 3) {
      extending.current = true;
      setRange((r) => ({ ...r, end: addDays(r.end, CHUNK) }));
    }
  };

  const jumpTo = (key, align = 'start') => {
    const idx = keys.indexOf(key);
    if (idx >= 0 && !custom) { scrollToIndex(idx, align, true); return; }
    setCustom(null);
    pendingJump.current = { key, align, smooth: false };
    setRange({ start: addDays(key, -CHUNK), end: addDays(key, CHUNK * 2) });
  };

  const scrollByCards = (n) => scroller.current?.scrollBy({ left: n * STEP, behavior: 'smooth' });

  const applyCustom = () => {
    const { start, end } = customDraft;
    if (!start || !end || start > end) { setCustomError('Choose a start date on or before the end date.'); return; }
    if (diffDays(start, end) > 366) { setCustomError('Choose a range of one year or less.'); return; }
    setCustomError('');
    setCustom({ start, end });
    pendingJump.current = { key: start, align: 'start', smooth: false };
    setRange({ start, end });
    setShowCustom(false);
  };
  const clearCustom = () => {
    setCustom(null);
    pendingJump.current = { key: today, align: 'center', smooth: false };
    setRange({ start: addDays(today, -CHUNK), end: addDays(today, CHUNK) });
  };

  const onSaved = () => {
    setVersion((v) => v + 1);
    onChange?.();
  };

  const presets = [
    { label: 'Today', run: () => jumpTo(today, 'center') },
    { label: 'Current Week', run: () => jumpTo(startOfWeek(today)) },
    { label: 'Current Month', run: () => jumpTo(startOfMonth(today)) },
    { label: 'Previous Month', run: () => jumpTo(addMonths(visibleKey, -1)) },
    { label: 'Next Month', run: () => jumpTo(addMonths(visibleKey, 1)) },
  ];

  return (
    <div className="panel overflow-hidden">
      {/* Period header + navigation */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => jumpTo(addMonths(visibleKey, -1))} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <h2 className="min-w-[190px] text-center text-xl font-bold tracking-tight sm:text-2xl" aria-live="polite">{monthLabel(visibleKey)}</h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => jumpTo(addMonths(visibleKey, 1))} aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => scrollByCards(-7)}><ChevronLeft size={14} />Previous</button>
          <button className="btn-primary btn-sm" onClick={() => jumpTo(today, 'center')}>Today</button>
          <button className="btn-secondary btn-sm" onClick={() => scrollByCards(7)}>Next<ChevronRight size={14} /></button>
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 sm:px-5">
        {presets.map((p) => (
          <button key={p.label} onClick={p.run} className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-ink-300 hover:text-ink-800">{p.label}</button>
        ))}
        <button onClick={() => setShowCustom((s) => !s)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${showCustom || custom ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 text-slate-600 hover:border-ink-300'}`}>
          <CalendarSearch size={13} />Custom Date Range
        </button>
        {custom && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-800">
            {fmtMedium(custom.start)} – {fmtMedium(custom.end)}
            <button onClick={clearCustom} aria-label="Clear custom range" className="rounded-full p-0.5 hover:bg-ink-100"><X size={12} /></button>
          </span>
        )}
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
          <div><label className="label text-xs" htmlFor="tl-start">From</label><input id="tl-start" type="date" className="input py-2" value={customDraft.start} onChange={(e) => setCustomDraft((d) => ({ ...d, start: e.target.value }))} /></div>
          <div><label className="label text-xs" htmlFor="tl-end">To</label><input id="tl-end" type="date" className="input py-2" value={customDraft.end} onChange={(e) => setCustomDraft((d) => ({ ...d, end: e.target.value }))} /></div>
          <button className="btn-primary btn-sm h-10" onClick={applyCustom}>Show dates</button>
          {customError && <div className="w-full text-sm text-red-600">{customError}</div>}
        </div>
      )}

      {/* The continuous strip */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="timeline-scroll flex snap-x snap-proximity gap-3 overflow-x-auto px-1 pb-5 pt-5"
        style={{ paddingLeft: PAD, paddingRight: PAD, scrollPaddingLeft: PAD }}
      >
        {keys.map((k) => {
          const onOpen = editable ? setOpenDate : undefined;
          if (single) {
            const t = trainees[0];
            const info = computeStatus({ dateKey: k, settings, record: records[t?.id]?.[k], now, trainee: t });
            return <DateCard key={k} dateKey={k} info={info} isToday={k === today} tz={tz} onOpen={onOpen} />;
          }
          const info = groupStatus({ dateKey: k, settings, trainees, recordsByTrainee: records, now });
          return <GroupDateCard key={k} dateKey={k} info={info} isToday={k === today} onOpen={onOpen} />;
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <Legend />
        <div className="text-xs text-slate-400">{custom ? 'Showing your custom range' : 'Scroll sideways to keep moving through dates'}</div>
      </div>

      {openDate && (
        <RegisterModal date={openDate} trainees={trainees} trainerNames={trainerNames} onClose={() => setOpenDate(null)} onSaved={onSaved} />
      )}
    </div>
  );
}
