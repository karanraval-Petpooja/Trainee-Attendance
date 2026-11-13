'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, FileText, Film, MessageCircle, Square, Video } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { ErrorText, PageHeader, Spinner } from '@/components/ui';
import { useTrainees } from '@/lib/hooks';
import { sb } from '@/lib/supabase';

// TEST FEATURE — Live sessions with Google Meet (managers + trainers switched on as testers).
// Trainer: Open Google Meet (their own account) → paste the link → Start → share the join link.
// Trainees: open the join link (no login) → Join Google Meet.
const MEET_RE = /^(?:https?:\/\/)?meet\.google\.com\/([a-z0-9][a-z0-9_-]{2,}(?:\/[a-z0-9_-]+)?)\/?(?:[?#].*)?$/i;
const cleanMeet = (v) => { const m = String(v || '').trim().match(MEET_RE); return m && m[1].replace(/[^a-z0-9]/gi, '').length >= 6 ? `https://meet.google.com/${m[1].toLowerCase()}` : null; };
// Google Drive / Docs links → the embeddable preview of the same file
const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\//i;
const previewOf = (u) => {
  if (!u) return null;
  const doc = u.match(/docs\.google\.com\/document\/d\/([^/?#]+)/); if (doc) return `https://docs.google.com/document/d/${doc[1]}/preview`;
  const file = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/); if (file) return `https://drive.google.com/file/d/${file[1]}/preview`;
  const open = u.match(/drive\.google\.com\/open\?id=([^&#]+)/); if (open) return `https://drive.google.com/file/d/${open[1]}/preview`;
  return null;
};

// Recording & transcript of one session: paste the links Google Meet emails you (or from Drive → Meet Recordings)
function SessionMedia({ s, onSaved }) {
  const { showToast } = useApp();
  const [rec, setRec] = useState(s.recording_url || '');
  const [tr, setTr] = useState(s.transcript_url || '');
  const [edit, setEdit] = useState(!s.recording_url && !s.transcript_url && s.status !== 'live');
  const [show, setShow] = useState(null); // 'rec' | 'tr'
  const [busy, setBusy] = useState(false);
  const save = async () => {
    for (const [v, n] of [[rec, 'recording'], [tr, 'transcript']]) if (v.trim() && !DRIVE_RE.test(v.trim())) { showToast(`The ${n} link must be a Google Drive / Docs link.`, 'error'); return; }
    setBusy(true);
    const { error } = await sb().from('live_sessions').update({ recording_url: rec.trim() || null, transcript_url: tr.trim() || null }).eq('id', s.id);
    setBusy(false);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Recording / transcript saved.'); setEdit(false); onSaved();
  };
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">Recording &amp; transcript</div>
        {!edit && <button type="button" className="text-xs font-semibold text-ink-700 hover:underline" onClick={() => setEdit(true)}>{s.recording_url || s.transcript_url ? 'Change links' : 'Add links'}</button>}
      </div>
      {!edit && (
        <div className="mt-2 flex flex-wrap gap-2">
          {s.recording_url && <>
            <a className="btn-secondary btn-sm" href={s.recording_url} target="_blank" rel="noreferrer"><Film size={14} />Watch recording</a>
            {previewOf(s.recording_url) && <button type="button" className="btn-ghost btn-sm" onClick={() => setShow(show === 'rec' ? null : 'rec')}>{show === 'rec' ? 'Hide' : 'Play here'}</button>}
          </>}
          {s.transcript_url && <>
            <a className="btn-secondary btn-sm" href={s.transcript_url} target="_blank" rel="noreferrer"><FileText size={14} />Read transcript</a>
            {previewOf(s.transcript_url) && <button type="button" className="btn-ghost btn-sm" onClick={() => setShow(show === 'tr' ? null : 'tr')}>{show === 'tr' ? 'Hide' : 'Read here'}</button>}
          </>}
          {!s.recording_url && !s.transcript_url && <span className="text-xs text-slate-400">Not here yet. With the Meet Recordings script set up, they appear here automatically (checked every 15 minutes, usually within an hour of the session). You can also add them by hand.</span>}
        </div>
      )}
      {edit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div><label className="label text-xs" htmlFor={`rec-${s.id}`}>Recording link (Google Drive)</label>
            <input id={`rec-${s.id}`} className="input py-1.5" placeholder="https://drive.google.com/file/d/…" value={rec} onChange={(e) => setRec(e.target.value)} /></div>
          <div><label className="label text-xs" htmlFor={`tr-${s.id}`}>Transcript link (Google Docs)</label>
            <input id={`tr-${s.id}`} className="input py-1.5" placeholder="https://docs.google.com/document/d/…" value={tr} onChange={(e) => setTr(e.target.value)} /></div>
          <p className="text-[11px] text-slate-500 sm:col-span-2">Turn on <b>Recording</b> and <b>Transcripts</b> in Meet (Activities). After the session, Google emails you both links; they are also in Drive → <b>Meet Recordings</b>. To let trainees open them, share the files with them in Drive.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner size={14} />}Save links</button>
            {(s.recording_url || s.transcript_url) && <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancel</button>}
          </div>
        </div>
      )}
      {show && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
          <iframe title={show === 'rec' ? 'Recording' : 'Transcript'} src={previewOf(show === 'rec' ? s.recording_url : s.transcript_url)} className="h-[420px] w-full" allow="autoplay; fullscreen" />
          <p className="bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">If it does not show, open it with the button above (you need to be signed in to Google with access to the file).</p>
        </div>
      )}
    </div>
  );
}

const clock = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function LivePage() {
  const { profile, now, showToast } = useApp();
  const router = useRouter();
  const inApp = Boolean(process.env.NEXT_PUBLIC_IN_APP_VIDEO); // set to "1" in Vercel once JaaS or your own Jitsi server is configured
  const [appTitle, setAppTitle] = useState('');
  const [appBatch, setAppBatch] = useState('');
  const allowed = profile.role === 'manager' || !!profile.meet_beta;
  const { batches } = useTrainees({ trainerId: profile.role === 'manager' ? null : profile.id });
  const [sessions, setSessions] = useState([]);
  const [title, setTitle] = useState('');
  const [batchId, setBatchId] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastKey = `lastMeet:${profile.id}`;
  const [lastLink, setLastLink] = useState(null);
  useEffect(() => { try { setLastLink(localStorage.getItem(lastKey)); } catch { /* ignore */ } }, [lastKey]);

  const load = useCallback(async () => {
    const { data } = await sb().from('live_sessions').select('*, batch:batches(code)').order('started_at', { ascending: false }).limit(40);
    setSessions(data || []);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const myBatches = useMemo(() => batches.filter((b) => b.status === 'active'), [batches]);
  const joinUrl = (s) => `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${s.code}`;
  const message = (s) => `Join today's training "${s.title}" here: ${joinUrl(s)}`;

  const start = async () => {
    const url = cleanMeet(link);
    if (!url) { setError('Paste the Google Meet link (it looks like https://meet.google.com/abc-defg-hij).'); return; }
    const name = title.trim() || `${myBatches.find((b) => b.id === batchId)?.code || 'Training'} · ${now.date.split('-').reverse().join('-')}`;
    setBusy(true); setError('');
    const { error: e } = await sb().from('live_sessions').insert({ trainer_id: profile.id, batch_id: batchId || null, title: name, meet_url: url });
    setBusy(false);
    if (e) { setError(e.message); return; }
    try { localStorage.setItem(lastKey, url); setLastLink(url); } catch { /* ignore */ }
    setTitle(''); setLink(''); showToast('Session started. Share the join link with your trainees.'); load();
  };
  // in-app session: the video runs inside the app (no Google Meet)
  const startInApp = async () => {
    const name = appTitle.trim() || `${myBatches.find((b) => b.id === appBatch)?.code || 'Training'} · ${now.date.split('-').reverse().join('-')}`;
    setBusy(true); setError('');
    const { data, error: e } = await sb().from('live_sessions').insert({ trainer_id: profile.id, batch_id: appBatch || null, title: name, provider: 'app' }).select('code').single();
    setBusy(false);
    if (e) { setError(e.message); return; }
    router.push(`/live/room/${data.code}`);
  };
  const end = async (s) => {
    if (!window.confirm(`End "${s.title}"? The join link will stop working.`)) return;
    const { error: e } = await sb().from('live_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', s.id);
    if (e) { showToast(e.message, 'error'); return; }
    showToast('Session ended.'); load();
  };
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); showToast(`${what} copied.`); } catch { showToast('Could not copy', 'error'); } };

  if (!allowed) {
    return <div className="panel p-6 text-sm text-slate-600">Live sessions are being tested and are not switched on for your account yet.</div>;
  }
  const live = sessions.filter((s) => s.status === 'live');
  const past = sessions.filter((s) => s.status !== 'live').slice(0, 15);

  return (
    <div className="space-y-5">
      <PageHeader title="Live sessions (test)" subtitle="Run training on Google Meet and let trainees join with one link. Start the Meet from your @petpooja.com account so it can run all day." />

      {inApp && (
        <section className="panel border-emerald-200 p-5">
          <h2 className="text-base font-bold">Start a session in the app</h2>
          <p className="mt-0.5 text-xs text-slate-500">The video runs inside this app: no Google Meet. Trainees join with the link, in their browser, without an account.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div><label className="label" htmlFor="ia-title">Session name</label><input id="ia-title" className="input" placeholder="e.g. Day 3 · Billing basics" value={appTitle} onChange={(e) => setAppTitle(e.target.value)} /></div>
            <div><label className="label" htmlFor="ia-batch">Batch (optional)</label>
              <select id="ia-batch" className="input" value={appBatch} onChange={(e) => setAppBatch(e.target.value)}><option value="">No batch</option>{myBatches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
            <button type="button" className="btn-primary" onClick={startInApp} disabled={busy}>{busy ? <Spinner size={16} /> : <Video size={16} />}Start session in the app</button>
          </div>
        </section>
      )}

      <section className="panel p-5">
        <h2 className="text-base font-bold">{inApp ? 'Or use Google Meet' : 'Start a session'}</h2>
        <ol className="mt-3 space-y-4 text-sm">
          <li className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="w-6 shrink-0 font-bold text-ink-700">1.</span>
            <button type="button" className="btn-primary w-fit" onClick={() => window.open('https://meet.new', '_blank', 'noopener')}><Video size={16} />Open Google Meet</button>
            <span className="text-xs text-slate-500">Opens a new meeting in your Google account. Copy its link (it starts with meet.google.com).</span>
          </li>
          <li className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="w-6 shrink-0 pt-2 font-bold text-ink-700">2.</span>
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              <div className="sm:col-span-3"><label className="label" htmlFor="lv-link">Google Meet link</label>
                <input id="lv-link" className="input" placeholder="https://meet.google.com/abc-defg-hij" value={link} onChange={(e) => { setLink(e.target.value); setError(''); }} />
                {lastLink && !link && <button type="button" className="mt-1 text-xs font-semibold text-ink-700 hover:underline" onClick={() => setLink(lastLink)}>Use my last link ({lastLink.replace('https://', '')})</button>}
              </div>
              <div className="sm:col-span-2"><label className="label" htmlFor="lv-title">Session name</label>
                <input id="lv-title" className="input" placeholder="e.g. Day 3 · Billing basics" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><label className="label" htmlFor="lv-batch">Batch (optional)</label>
                <select id="lv-batch" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                  <option value="">No batch</option>{myBatches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select></div>
            </div>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-bold text-ink-700">3.</span>
            <button type="button" className="btn-primary" onClick={start} disabled={busy || !link}>{busy && <Spinner size={16} />}Start session</button>
          </li>
        </ol>
        <div className="mt-2"><ErrorText>{error}</ErrorText></div>
      </section>

      <section className="panel p-5">
        <h2 className="text-base font-bold">Live now ({live.length})</h2>
        {!live.length && <p className="mt-2 text-sm text-slate-400">No session running.</p>}
        <div className="mt-3 space-y-3">
          {live.map((s) => (
            <div key={s.id} className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-bold text-ink-900"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{s.title}</div>
                  <div className="text-xs text-slate-500">Started {clock(s.started_at)}{s.batch?.code ? ` · ${s.batch.code}` : ''}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.provider === 'app'
                    ? <button type="button" className="btn-primary btn-sm" onClick={() => router.push(`/live/room/${s.code}`)}><Video size={14} />Open room</button>
                    : <a className="btn-primary btn-sm" href={s.meet_url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open Meet</a>}
                  <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => end(s)}><Square size={14} />End session</button>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-white p-3">
                <div className="text-xs font-semibold text-slate-500">Join link for trainees (no login needed)</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-slate-50 px-2 py-1 text-xs text-ink-800">{joinUrl(s)}</code>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => copy(joinUrl(s), 'Join link')}><Copy size={14} />Copy link</button>
                  <a className="btn btn-sm bg-[#25D366] text-white hover:brightness-95" href={`https://wa.me/?text=${encodeURIComponent(message(s))}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>
                </div>
              </div>
              {s.provider !== 'app' && <SessionMedia s={s} onSaved={load} />}
            </div>
          ))}
        </div>
      </section>

      {past.length > 0 && (
        <section className="panel p-5">
          <h2 className="text-base font-bold">Earlier sessions</h2>
          <ul className="mt-2 space-y-3 text-sm">
            {past.map((s) => (
              <li key={s.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{s.title}{s.batch?.code ? <span className="text-slate-400"> · {s.batch.code}</span> : ''}</span>
                  <span className="text-xs text-slate-500">{clock(s.started_at)} → {s.ended_at ? clock(s.ended_at) : '—'}</span>
                </div>
                {s.provider !== 'app' && <SessionMedia s={s} onSaved={load} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
