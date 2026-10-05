'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileUp } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import OjtCharts, { saveBlob, svgToPngBlob } from '@/components/ojt/OjtCharts';
import { PageHeader, PageLoader, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { parseMeetFileName, readOjtWorkbook, suggestSessionMinutes } from '@/lib/ojt';

export default function OjtChartsPage() {
  const { showToast } = useApp();
  const [mode, setMode] = useState('saved'); // saved | file
  const [sessions, setSessions] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [rowsBy, setRowsBy] = useState({});
  const [fileData, setFileData] = useState(null);
  const [reading, setReading] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const [withScores, setWithScores] = useState(false);
  const area = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb().from('ojt_sessions').select('*').order('session_date', { ascending: false });
      setSessions(data || []);
      const wanted = new URLSearchParams(window.location.search).get('session');
      const first = wanted || data?.[0]?.id;
      if (first) setPicked(new Set([first]));
      if (!data?.length) setMode('file');
    })();
  }, []);

  useEffect(() => {
    const missing = [...picked].filter((id) => !rowsBy[id]);
    if (!missing.length) return;
    (async () => {
      const { data } = await sb().from('ojt_participants').select('*').in('session_id', missing);
      const add = {};
      missing.forEach((id) => { add[id] = []; });
      (data || []).forEach((p) => add[p.session_id].push(p));
      setRowsBy((cur) => ({ ...cur, ...add }));
    })();
  }, [picked, rowsBy]);

  const toggle = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setReading(true);
    try {
      const buf = await f.arrayBuffer();
      const meta = parseMeetFileName(f.name);
      const first = await readOjtWorkbook(buf, { includeScores: withScores });
      const length = suggestSessionMinutes(first.span, meta.time);
      const res = length ? await readOjtWorkbook(buf, { includeScores: withScores, requiredMinutes: Math.round(length / 2) }) : first;
      setFileData({ title: meta.title || f.name.replace(/\.xlsx$/i, ''), date: meta.date || '', rows: res.participants, rule: length ? Math.round(length / 2) : null });
    }
    catch (err) { showToast(err.message, 'error'); }
    setReading(false);
  };

  const chartSessions = mode === 'file'
    ? (fileData ? [{ title: fileData.title, date: fileData.date, rows: fileData.rows }] : [])
    : (sessions || []).filter((s) => picked.has(s.id) && rowsBy[s.id]).map((s) => ({ title: `${s.session_type || 'OJT'} · ${s.title}`, date: fmtMedium(s.session_date), rows: rowsBy[s.id] }));

  // One tall PNG with every chart
  const downloadAll = async () => {
    const svgs = [...(area.current?.querySelectorAll('svg[role="img"]') || [])];
    if (!svgs.length) return;
    setAllBusy(true);
    const imgs = await Promise.all(svgs.map(async (s) => createImageBitmap(await svgToPngBlob(s, 2))));
    const width = Math.max(...imgs.map((i) => i.width));
    const gap = 30;
    const height = imgs.reduce((n, i) => n + i.height + gap, gap);
    const canvas = document.createElement('canvas');
    canvas.width = width + gap * 2; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = gap;
    imgs.forEach((i) => { ctx.drawImage(i, gap, y); y += i.height + gap; });
    canvas.toBlob((b) => { saveBlob(b, 'OJT_Charts.png'); setAllBusy(false); }, 'image/png');
  };

  if (sessions === null) return <PageLoader />;

  return (
    <div className="space-y-5">
      <Link href="/ojt" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-700 hover:underline"><ArrowLeft size={14} />OJT / Upskill / PIP / Refresher sessions</Link>
      <PageHeader title="OJT / Upskill / PIP / Refresher charts" subtitle="Charts are made automatically from the sheet. Download them as PNG, copy the image, or copy the numbers."
        actions={chartSessions.length > 0 && <button className="btn-primary" onClick={downloadAll} disabled={allBusy}>{allBusy ? <Spinner size={16} /> : <Download size={16} />}Download all charts</button>} />

      <div className="panel p-4">
        <div className="flex rounded-xl border border-slate-200 p-1 text-sm font-semibold sm:w-fit">
          <button onClick={() => setMode('saved')} className={`rounded-lg px-4 py-1.5 ${mode === 'saved' ? 'bg-ink-800 text-white' : 'text-slate-600'}`}>Saved sessions</button>
          <button onClick={() => setMode('file')} className={`rounded-lg px-4 py-1.5 ${mode === 'file' ? 'bg-ink-800 text-white' : 'text-slate-600'}`}>Upload a file</button>
        </div>
        {mode === 'saved' ? (
          sessions.length === 0 ? <p className="mt-3 text-sm text-slate-500">No saved sessions yet. Upload one on the Sessions page, or switch to “Upload a file”.</p> : (
            <div className="mt-3 flex flex-wrap gap-2">
              {sessions.map((s) => (
                <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${picked.has(s.id) ? 'border-ink-800 bg-ink-50' : 'border-slate-200'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-700">{s.session_type || 'OJT'}</span>
                  <span className="font-semibold text-slate-800">{s.title}</span><span className="text-xs text-slate-400">{fmtMedium(s.session_date)}</span>
                </label>
              ))}
              <p className="w-full text-xs text-slate-400">Tick more than one session to compare them.</p>
            </div>
          )
        ) : (
          <div className="mt-3 text-sm">
            <label className="font-semibold text-ink-800" htmlFor="chart-file"><FileUp size={16} className="mr-1 inline" />Choose an Excel file (.xlsx)</label>
            <p className="text-xs text-slate-500">Charts only; the file is not saved. Present = attended at least half of the session (to set your own minimum, save it as a session instead).</p>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-ink-800" checked={withScores} onChange={(e) => setWithScores(e.target.checked)} />
              Include assessment scores (optional) — choose before picking the file
            </label>
            <input id="chart-file" type="file" accept=".xlsx" onChange={onFile} className="mt-2 block text-xs" />
            {reading && <p className="mt-2 text-xs text-slate-500"><Spinner size={12} /> Reading…</p>}
          </div>
        )}
      </div>

      <div ref={area}>
        {chartSessions.length > 0 ? <OjtCharts sessions={chartSessions} /> : (
          <div className="panel p-8 text-center text-sm text-slate-500">{mode === 'file' ? 'Choose a file to see its charts.' : 'Tick a session to see its charts.'}</div>
        )}
      </div>
    </div>
  );
}
