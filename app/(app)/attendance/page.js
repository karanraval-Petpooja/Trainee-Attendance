'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { RegisterList } from '@/components/Register';
import { PageHeader, PageLoader } from '@/components/ui';
import { useTrainees, useTrainers } from '@/lib/hooks';
import { addDays, fmtLong } from '@/lib/dates';
import { scopeTo } from '@/lib/status';

export default function AttendancePage() {
  const { profile, now } = useApp();
  const isManager = profile.role === 'manager';
  const [date, setDate] = useState(now.date);
  const [trainerId, setTrainerId] = useState(isManager ? 'all' : profile.id);
  const { trainees, loading } = useTrainees(isManager ? {} : { trainerId: profile.id });
  const { trainers } = useTrainers();
  const trainerNames = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (isManager && p.get('trainer')) setTrainerId(p.get('trainer'));
    if (p.get('date')) setDate(p.get('date'));
  }, [isManager]);

  const [batchId, setBatchId] = useState('all');
  const scoped = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const batchOptions = useMemo(() => [...new Map(scoped.filter((t) => t._batch).map((t) => [t._batch.id, t._batch])).values()].sort((a, b) => a.code.localeCompare(b.code)), [scoped]);
  const list = useMemo(() => (batchId === 'all' ? scoped : scoped.filter((t) => (batchId === 'none' ? !t.batch_id : t.batch_id === batchId))), [scoped, batchId]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={isManager ? 'Attendance register' : 'Mark attendance'}
        subtitle={fmtLong(date)}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {isManager && (
              <select className="input w-auto" value={trainerId} onChange={(e) => setTrainerId(e.target.value)} aria-label="Trainer">
                <option value="all">All trainers</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {batchOptions.length > 0 && (
              <select className="input w-auto" value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Batch">
                <option value="all">All batches</option>
                {batchOptions.map((b) => <option key={b.id} value={b.id}>{b.code}{b.name ? ` · ${b.name}` : ''}</option>)}
                <option value="none">No batch</option>
              </select>
            )}
            <button className="btn-secondary btn-sm h-[42px]" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
            <input type="date" className="input w-auto" value={date} max={now.date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <button className="btn-secondary btn-sm h-[42px]" onClick={() => setDate(addDays(date, 1))} disabled={date >= now.date} aria-label="Next day"><ChevronRight size={16} /></button>
            <button className="btn-primary btn-sm h-[42px]" onClick={() => setDate(now.date)}>Today</button>
          </div>
        )}
      />
      <section className="panel p-5">
        {loading ? <PageLoader /> : (
          <RegisterList key={`${date}-${trainerId}`} date={date} trainees={list} trainerNames={isManager ? trainerNames : undefined} />
        )}
      </section>
      <p className="text-xs text-slate-400">Choose Holiday for days the batch is off (festival or company holiday). Sundays and 2nd/4th Saturdays are week offs automatically.</p>
    </div>
  );
}
