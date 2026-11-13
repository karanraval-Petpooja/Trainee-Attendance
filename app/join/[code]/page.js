'use client';
import { useEffect, useState } from 'react';
import JitsiRoom from '@/components/live/JitsiRoom';
import { useParams } from 'next/navigation';
import { FileText, Film, Video } from 'lucide-react';
import { sb } from '@/lib/supabase';

// Public join page for trainees (no login): shows the session and a Join Google Meet button.
export default function JoinPage() {
  const { code } = useParams();
  const [s, setS] = useState(undefined); // undefined = loading, null = not found
  const [name, setName] = useState('');
  const [pass, setPass] = useState(null);
  const [joinError, setJoinError] = useState('');
  const join = async () => {
    setJoinError('');
    const res = await fetch('/api/live-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setJoinError(j.error || 'Could not join. Try again.'); return; }
    setPass(j);
  };
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const { data } = await sb().rpc('get_live_session', { p_code: String(code || '') });
      if (!stop) setS(data?.[0] || null);
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [code]);

  if (pass && s?.status === 'live') {
    return (
      <main className="flex h-screen flex-col bg-slate-900 p-2">
        <div className="px-2 pb-2 text-sm font-semibold text-white">{s.title} · {s.trainer}</div>
        <div className="min-h-0 flex-1"><JitsiRoom pass={pass} onLeave={() => setPass(null)} /></div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 text-white"><Video size={26} /></div>
        {s === undefined && <p className="mt-5 text-sm text-slate-500">Loading the session…</p>}
        {s === null && <><h1 className="mt-5 text-xl font-bold text-ink-900">Session not found</h1><p className="mt-2 text-sm text-slate-500">Please check the link with your trainer.</p></>}
        {s && (
          <>
            <h1 className="mt-5 text-xl font-bold text-ink-900">{s.title}</h1>
            <p className="mt-1 text-sm text-slate-500">Trainer: {s.trainer}</p>
            {s.status === 'live' && s.provider === 'app' ? (
              <div className="mt-6 text-left">
                <label className="label" htmlFor="jn-name">Your name</label>
                <input id="jn-name" className="input" placeholder="e.g. Asha Patel" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && join()} />
                <button type="button" onClick={join} disabled={!name.trim()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><Video size={20} />Join session</button>
                {joinError && <p className="mt-2 text-sm text-red-600">{joinError}</p>}
                <p className="mt-3 text-xs text-slate-500">Allow camera and microphone when the browser asks. Works on phone and computer, no app needed.</p>
              </div>
            ) : s.status === 'live' && s.meet_url ? (
              <>
                <a href={s.meet_url} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-lg font-bold text-white hover:bg-emerald-700"><Video size={20} />Join Google Meet</a>
                <ul className="mt-4 space-y-1 text-left text-xs text-slate-500">
                  <li>• Allow camera and microphone when the browser asks.</li>
                  <li>• On a phone, it opens in the Google Meet app if it is installed.</li>
                  <li>• If you get disconnected, open this page again and tap Join.</li>
                </ul>
              </>
            ) : (
              <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">This session has ended.</p>
            )}
            {(s.recording_url || s.transcript_url) && (
              <div className="mt-4 grid gap-2">
                {s.recording_url && <a href={s.recording_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-ink-800 hover:bg-slate-50"><Film size={16} />Watch the recording</a>}
                {s.transcript_url && <a href={s.transcript_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-ink-800 hover:bg-slate-50"><FileText size={16} />Read the transcript</a>}
              </div>
            )}
          </>
        )}
        <p className="mt-6 text-[11px] text-slate-400">Petpooja Learning &amp; Development</p>
      </div>
    </main>
  );
}
