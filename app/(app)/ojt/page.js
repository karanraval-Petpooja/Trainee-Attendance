'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, FileUp, Search } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import OjtUpload from '@/components/ojt/OjtUpload';
import { Empty, PageHeader, PageLoader } from '@/components/ui';
import { useTrainers } from '@/lib/hooks';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { summarizeOjt } from '@/lib/ojt';

export default function OjtPage() {
  const { profile, showToast } = useApp();
  const router = useRouter();
  const { trainers } = useTrainers();
  const [sessions, setSessions] = useState(null);
  const [upload, setUpload] = useState(false);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');

  const load = async () => {
    const { data: s } = await sb().from('ojt_sessions').select('*').order('session_date', { ascending: false });
    const ids = (s || []).map((x) => x.id);
    const parts = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb().from('ojt_participants').select('session_id, attendance, result, score, total, duration_minutes').in('session_id', ids.slice(i, i + 100));
      parts.push(...(data || []));
    }
    const by = {};
    parts.forEach((p) => { (by[p.session_id] ||= []).push(p); });
    setSessions((s || []).map((x) => ({ ...x, sum: summarizeOjt(by[x.id] || []) })));
  };
  useEffect(() => { load(); }, []);

  const names = Object.fromEntries(trainers.map((t) => [t.id, t.name]));
  const list = (sessions || []).filter((s) => (type === 'all' || (s.session_type || 'OJT') === type)
    && [s.title, names[s.trainer_id], s.source_file].some((v) => v?.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-5">
      <PageHeader title="OJT / Upskill / PIP / Refresher sessions" subtitle="Upload the attendance + score sheet to create a session."
        actions={(
          <>
            <Link href="/ojt/charts" className="btn-secondary"><BarChart3 size={16} />Charts</Link>
            <button className="btn-primary" onClick={() => setUpload(true)}><FileUp size={16} />Upload sheet</button>
          </>
        )} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search sessions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" />
        </div>
        <select className="input sm:w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="all">All types</option><option value="OJT">OJT</option><option value="Upskill">Upskill</option><option value="PIP">PIP</option><option value="Refresher">Refresher</option>
        </select>
      </div>
      <div className="panel overflow-hidden">
        {!sessions ? <PageLoader /> : list.length === 0 ? (
          <Empty title="No sessions yet">Click “Upload sheet” and choose your Attendance Tracking file.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Session</th><th>Type</th><th>Date</th><th>Trainer</th><th>Participants</th><th>Attendance</th><th>Pass rate</th><th>Avg score</th><th /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/ojt/${s.id}`)}>
                    <td><div className="font-semibold text-slate-800">{s.title}</div>{s.source_file && <div className="text-xs text-slate-400">{s.source_file}</div>}</td>
                    <td><span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-bold text-ink-700">{s.session_type || 'OJT'}</span></td>
                    <td className="text-slate-600">{fmtMedium(s.session_date)}</td>
                    <td className="text-slate-600">{s.trainer_id === profile.id ? 'You' : names[s.trainer_id] || '—'}</td>
                    <td>{s.sum.participants}</td>
                    <td>{s.sum.attendancePct === null ? '—' : `${s.sum.attendancePct}%`}</td>
                    <td className={s.sum.passPct !== null && s.sum.passPct < 60 ? 'font-bold text-red-600' : 'font-semibold text-slate-800'}>{s.sum.passPct === null ? '—' : `${s.sum.passPct}%`}</td>
                    <td>{s.sum.avgScorePct === null ? '—' : `${s.sum.avgScorePct}%`}</td>
                    <td><Link href={`/ojt/charts?session=${s.id}`} className="btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}><BarChart3 size={14} />Charts</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {upload && <OjtUpload trainers={trainers} onClose={() => setUpload(false)} onSaved={(id) => { showToast('Session saved.'); router.push(`/ojt/${id}`); }} />}
    </div>
  );
}
