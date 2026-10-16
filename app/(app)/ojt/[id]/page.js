'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BarChart3, FileSpreadsheet, Search, Send, Trash2 } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner, StatCard } from '@/components/ui';
import { useTrainers } from '@/lib/hooks';
import { authFetch, sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { downloadOjtWorkbook, fmtDuration, hasScores, summarizeOjt } from '@/lib/ojt';

// Upskill / Refresher → Training Log Google Sheet (one row per participant; Sr. No continues per trainer)
function PushToSheet({ session, rows, trainerName, onClose, onDone }) {
  const [topic, setTopic] = useState(session.topic || session.title || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = rows.filter((r) => r.attendance === 'P').length;
  const push = async () => {
    if (topic.trim().length < 2) { setError('Write the topic of the session.'); return; }
    setBusy(true); setError('');
    try {
      const j = await authFetch('/api/training-log', { method: 'POST', body: JSON.stringify({ sessionId: session.id, topic: topic.trim() }) });
      if (!j.ok) throw new Error(j.error || 'Could not push to the sheet');
      onDone(j, topic.trim());
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Modal title="Push to training sheet" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Later</button><button className="btn-primary" onClick={push} disabled={busy}>{busy ? <Spinner size={16} /> : <Send size={16} />}Push {rows.length} rows</button></>}>
      <label className="label" htmlFor="tl-topic">Topic</label>
      <input id="tl-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What was this session about?" autoFocus />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 text-sm">
        <dt className="text-slate-500">Course type</dt><dd className="font-semibold">{session.session_type}</dd>
        <dt className="text-slate-500">Trainer Name</dt><dd className="font-semibold">{trainerName || '—'}</dd>
        <dt className="text-slate-500">Date</dt><dd className="font-semibold">{fmtMedium(session.session_date)}</dd>
        <dt className="text-slate-500">Completion Status</dt><dd className="font-semibold">{done} Completed · {rows.length - done} Not Completed</dd>
      </dl>
      <p className="mt-3 text-xs text-slate-500">One row per participant. Sr. No continues from this trainer’s last number in the sheet. Location, Location Type (Ahmedabad / Outside Ahmedabad), Designation and Department come from Contact Details. Rows already in the sheet are not added again.</p>
      {session.pushed_at && <p className="mt-2 text-xs font-semibold text-emerald-700">Already pushed on {fmtMedium(session.pushed_at.slice(0, 10))}{session.pushed_sr ? ` (Sr. No ${session.pushed_sr})` : ''}. Pushing again only adds missing rows.</p>}
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

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
  const [pushOpen, setPushOpen] = useState(false);
  const search = useSearchParams();

  useEffect(() => {
    (async () => {
      const { data: s } = await sb().from('ojt_sessions').select('*').eq('id', id).single();
      const { data: p } = await sb().from('ojt_participants').select('*').eq('session_id', id).order('full_name');
      setSession(s || false);
      setRows(p || []);
    })();
  }, [id]);

  // straight after an Upskill / Refresher upload: offer the push automatically
  useEffect(() => {
    if (session && search.get('push') === '1' && ['upskill', 'refresher'].includes(String(session.session_type || '').toLowerCase()) && !session.pushed_at) setPushOpen(true);
  }, [session, search]);
  const sum = useMemo(() => summarizeOjt(rows), [rows]);
  const scored = useMemo(() => hasScores(rows), [rows]);
  if (session === null) return <PageLoader />;
  if (session === false) return <Empty title="Session not found" />;

  const trainer = trainers.find((t) => t.id === session.trainer_id);
  const canPush = ['upskill', 'refresher'].includes(String(session.session_type || '').toLowerCase())
    && (profile.role === 'manager' || session.trainer_id === profile.id || session.created_by === profile.id);
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
        subtitle={`${fmtMedium(session.session_date)}${trainer ? ` · ${trainer.name}` : ''}${session.department ? ` · ${session.department}` : ''}${session.session_minutes ? ` · session ${fmtDuration(session.session_minutes)}` : ''}${session.min_present_minutes ? ` · Present needs ${fmtDuration(session.min_present_minutes)}` : ''}${session.source_file ? ` · ${session.source_file}` : ''}`}
        actions={(
          <>
            {canPush && (
              <button className={session.pushed_at ? 'btn-secondary' : 'btn-primary'} onClick={() => setPushOpen(true)}>
                <Send size={16} />{session.pushed_at ? `Pushed${session.pushed_sr ? ` · Sr. ${session.pushed_sr}` : ''}` : 'Push to training sheet'}
              </button>
            )}
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
                  <td className={r.attendance === 'A' ? 'font-semibold text-red-700' : ''}>{r.not_attended ? 'Not attended' : fmtDuration(r.duration_minutes) || 'did not join'}</td>
                  <td className="text-slate-500">{r.time_joined || '—'}</td>
                  <td className="text-slate-500">{r.time_exited || '—'}</td>
                  <td>{r.attendance ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip[r.attendance]}`}>{r.not_attended ? 'A · Not attended' : r.attendance}</span> : '—'}</td>
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
      {pushOpen && (
        <PushToSheet session={session} rows={rows} trainerName={trainer?.name || (session.trainer_id === profile.id ? profile.name : '')}
          onClose={() => setPushOpen(false)}
          onDone={(j, topic) => {
            setPushOpen(false);
            setSession({ ...session, topic, pushed_at: new Date().toISOString(), pushed_sr: j.added ? `${j.from}–${j.to}` : session.pushed_sr });
            showToast(j.added ? `Pushed ${j.added} rows to “${j.tab}” (Sr. No ${j.from}–${j.to})${j.skipped ? `, ${j.skipped} already there` : ''}.` : `Nothing new: all ${j.skipped} rows are already in the sheet.`);
          }} />
      )}
    </div>
  );
}
