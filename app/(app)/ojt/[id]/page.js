'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BarChart3, FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, PageHeader, PageLoader, StatCard } from '@/components/ui';
import { useTrainers } from '@/lib/hooks';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { downloadOjtWorkbook, fmtDuration, hasScores, summarizeOjt } from '@/lib/ojt';

const chip = { P: 'bg-emerald-100 text-emerald-800', A: 'bg-red-600 text-white', Pass: 'bg-emerald-100 text-emerald-800', Fail: 'bg-red-100 text-red-800', Absent: 'bg-amber-100 text-amber-800' };

export default function OjtSessionPage() {
  const { id } = useParams();
  const router = useRouter();
  const { profile, showToast } = useApp();
  const { trainers } = useTrainers();
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const { data: s } = await sb().from('ojt_sessions').select('*').eq('id', id).single();
      const { data: p } = await sb().from('ojt_participants').select('*').eq('session_id', id).order('full_name');
      setSession(s || false);
      setRows(p || []);
    })();
  }, [id]);

  const sum = useMemo(() => summarizeOjt(rows), [rows]);
  const scored = useMemo(() => hasScores(rows), [rows]);
  if (session === null) return <PageLoader />;
  if (session === false) return <Empty title="Session not found" />;

  const trainer = trainers.find((t) => t.id === session.trainer_id);
  const canDelete = profile.role === 'manager' || session.created_by === profile.id;
  const shown = rows.filter((r) => (filter === 'all' || r.attendance === filter || r.result === filter)
    && [r.full_name, r.email].some((v) => v?.toLowerCase().includes(q.toLowerCase())));

  const remove = async () => {
    if (!window.confirm(`Delete the OJT session “${session.title}” and its ${rows.length} participants?`)) return;
    const { error } = await sb().from('ojt_sessions').delete().eq('id', session.id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Session deleted.');
    router.replace('/ojt');
  };

  return (
    <div className="space-y-5">
      <Link href="/ojt" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-700 hover:underline"><ArrowLeft size={14} />All OJT / Upskill / PIP / Refresher sessions</Link>
      <PageHeader title={<span>{session.title} <span className="ml-1 align-middle rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-bold text-ink-700">{session.session_type || 'OJT'}</span></span>}
        subtitle={`${fmtMedium(session.session_date)}${trainer ? ` · ${trainer.name}` : ''}${session.session_minutes ? ` · session ${fmtDuration(session.session_minutes)}` : ''}${session.min_present_minutes ? ` · Present needs ${fmtDuration(session.min_present_minutes)}` : ''}${session.source_file ? ` · ${session.source_file}` : ''}`}
        actions={(
          <>
            <Link href={`/ojt/charts?session=${session.id}`} className="btn-secondary"><BarChart3 size={16} />Charts</Link>
            <button className="btn-primary" onClick={() => downloadOjtWorkbook(rows, `${session.title.replace(/[^a-z0-9]+/gi, '_')}_${session.session_date}.xlsx`)}><FileSpreadsheet size={16} />Download Excel</button>
            {canDelete && <button className="btn-ghost" onClick={remove} aria-label="Delete session"><Trash2 size={16} className="text-red-600" /></button>}
          </>
        )} />

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${scored ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
        <StatCard label="Participants" value={sum.participants} />
        <StatCard label="Present" value={sum.present} tone="green" hint={sum.attendancePct === null ? '' : `${sum.attendancePct}%`} />
        <StatCard label="Absent" value={sum.absent} tone="red" hint={session.min_present_minutes ? `below ${fmtDuration(session.min_present_minutes)}` : ''} />
        {!scored && <StatCard label="Average time" value={sum.avgMinutes ? fmtDuration(sum.avgMinutes) : '—'} />}
        {scored && <>
          <StatCard label="Pass" value={sum.pass} tone="green" hint={sum.passPct === null ? '' : `${sum.passPct}% of those who took it`} />
          <StatCard label="Fail" value={sum.fail} tone="red" hint={sum.assessAbsent ? `${sum.assessAbsent} absent in assessment` : ''} />
          <StatCard label="Average score" value={sum.avgScorePct === null ? '—' : `${sum.avgScorePct}%`} hint={sum.avgMinutes ? `avg time ${fmtDuration(sum.avgMinutes)}` : ''} />
        </>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search participants" />
        </div>
        <select className="input sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="all">Everyone</option><option value="P">Present</option><option value="A">Absent</option>
          {scored && <><option value="Pass">Pass</option><option value="Fail">Fail</option><option value="Absent">Absent in assessment</option></>}
        </select>
      </div>

      <div className="panel overflow-hidden">
        <div className="table-wrap max-h-[65vh] overflow-y-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10"><tr><th>Full Name</th><th>Email</th><th>Duration</th><th>Joined</th><th>Exited</th><th>Attendance</th>{scored && <><th>Score</th><th>Pass/ Fail</th></>}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.attendance === 'A' ? 'bg-red-50' : ''}>
                  <td className={`font-semibold ${r.attendance === 'A' ? 'text-red-700' : 'text-slate-800'}`}>{r.full_name}</td>
                  <td className="text-slate-500">{r.email || '—'}</td>
                  <td className={r.attendance === 'A' ? 'font-semibold text-red-700' : ''}>{fmtDuration(r.duration_minutes) || 'did not join'}</td>
                  <td className="text-slate-500">{r.time_joined || '—'}</td>
                  <td className="text-slate-500">{r.time_exited || '—'}</td>
                  <td>{r.attendance ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip[r.attendance]}`}>{r.attendance}</span> : '—'}</td>
                  {scored && <>
                    <td>{r.score ?? '—'}{r.total ? <span className="text-slate-400"> / {r.total}</span> : ''}</td>
                    <td>{r.result ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip[r.result]}`}>{r.result}</span> : '—'}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
