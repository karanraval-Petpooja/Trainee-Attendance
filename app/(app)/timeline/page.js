'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppShell';
import MonthCalendar from '@/components/MonthCalendar';
import TeamGrid from '@/components/TeamGrid';
import { RegisterModal } from '@/components/Register';
import { PageHeader, PageLoader } from '@/components/ui';
import { useTrainees, useTrainers } from '@/lib/hooks';
import { fmtMedium } from '@/lib/dates';
import { EXIT_LABELS, scopeTo } from '@/lib/status';

export default function TimelinePage() {
  const { profile } = useApp();
  const isManager = profile.role === 'manager';
  const { trainees, loading } = useTrainees(isManager ? { includeInactive: true } : { trainerId: profile.id, includeInactive: true });
  const { trainers } = useTrainers();
  const trainerNames = useMemo(() => Object.fromEntries(trainers.map((t) => [t.id, t.name])), [trainers]);
  const [trainerId, setTrainerId] = useState('all');
  const [view, setView] = useState('summary'); // summary | grid | <traineeId>
  const [gridDate, setGridDate] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('trainee')) setView(p.get('trainee'));
    if (p.get('trainer')) setTrainerId(p.get('trainer'));
  }, []);

  const [batchId, setBatchId] = useState('all');
  const scoped = useMemo(() => scopeTo(trainees, trainerId), [trainees, trainerId]);
  const batchOptions = useMemo(() => [...new Map(scoped.filter((t) => t._batch).map((t) => [t._batch.id, t._batch])).values()].sort((a, b) => a.code.localeCompare(b.code)), [scoped]);
  const pool = useMemo(() => (batchId === 'all' ? scoped : scoped.filter((t) => t.batch_id === batchId)), [scoped, batchId]);
  const activePool = useMemo(() => pool.filter((t) => t.status === 'active'), [pool]);
  const trainee = trainees.find((t) => t.id === view);

  const choose = (v) => {
    setView(v);
    window.history.replaceState(null, '', ['summary', 'grid'].includes(v) ? '/timeline' : `/timeline?trainee=${v}`);
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Date-wise calendar"
        subtitle={trainee ? `${trainee.name} · DOJ ${fmtMedium(trainee.joining_date)} · ${trainee.tcd_lwd ? `TCD/LWD ${fmtMedium(trainee.tcd_lwd)}` : EXIT_LABELS[trainee.exit_reason || '']}` : view === 'grid' ? 'Every trainee, date by date' : 'Your batch, date by date'}
        actions={(
          <div className="flex flex-wrap gap-2">
            {isManager && (
              <select className="input w-auto" value={trainerId} onChange={(e) => { setTrainerId(e.target.value); if (!['summary', 'grid'].includes(view)) choose('summary'); }} aria-label="Trainer">
                <option value="all">All trainers</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {batchOptions.length > 0 && (
              <select className="input w-auto" value={batchId} onChange={(e) => { setBatchId(e.target.value); if (!['summary', 'grid'].includes(view)) choose('summary'); }} aria-label="Batch">
                <option value="all">All batches</option>
                {batchOptions.map((b) => <option key={b.id} value={b.id}>{b.code}{b.name ? ` · ${b.name}` : ''}</option>)}
              </select>
            )}
            <select className="input w-auto min-w-[220px]" value={view} onChange={(e) => choose(e.target.value)} aria-label="View">
              <option value="summary">All trainees — calendar</option>
              <option value="grid">All trainees — table (trainee × date)</option>
              <optgroup label="One trainee">
                {pool.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status !== 'active' ? ' (inactive)' : ''}</option>)}
              </optgroup>
            </select>
          </div>
        )}
      />

      {view === 'summary' && <MonthCalendar key={`sum-${trainerId}-${batchId}`} trainees={activePool} editable trainerNames={isManager ? trainerNames : undefined} />}
      {view === 'grid' && (
        <>
          <TeamGrid key={`grid-${trainerId}-${batchId}`} trainees={activePool} trainerNames={isManager ? trainerNames : undefined} onOpenDate={(k, reload) => setGridDate({ k, reload })} />
          {gridDate && <RegisterModal date={gridDate.k} trainees={activePool} trainerNames={isManager ? trainerNames : undefined} onClose={() => setGridDate(null)} onSaved={gridDate.reload} />}
        </>
      )}
      {trainee && (
        <>
          <MonthCalendar key={trainee.id} trainees={[trainee]} single editable />
        </>
      )}
    </div>
  );
}
