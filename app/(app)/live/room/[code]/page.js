'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Copy, MessageCircle, Square } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import JitsiRoom from '@/components/live/JitsiRoom';
import { PageLoader } from '@/components/ui';
import { authFetch, sb } from '@/lib/supabase';

// TEST FEATURE — the trainer's in-app session room (host).
export default function RoomPage() {
  const { code } = useParams();
  const router = useRouter();
  const { showToast } = useApp();
  const [s, setS] = useState(null);
  const [pass, setPass] = useState(null);
  const [error, setError] = useState('');
  const api = useRef(null);
  useEffect(() => {
    (async () => {
      const { data } = await sb().from('live_sessions').select('*').eq('code', code).single();
      if (!data) { setError('Session not found.'); return; }
      setS(data);
      if (data.status !== 'live') { setError('This session has ended.'); return; }
      try { setPass(await authFetch('/api/live-token', { method: 'POST', body: JSON.stringify({ code }) })); }
      catch (e) { setError(e.message); }
    })();
  }, [code]);
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(joinUrl); showToast('Join link copied.'); } catch { showToast('Could not copy', 'error'); } };
  const end = async () => {
    if (!window.confirm('End the session for everyone?')) return;
    try { api.current?.executeCommand('endConference'); } catch { /* ignore */ }
    await sb().from('live_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', s.id);
    showToast('Session ended.'); router.push('/live');
  };
  if (error) return <div className="panel p-6 text-sm text-slate-600">{error} <button type="button" className="ml-2 font-semibold text-ink-700 hover:underline" onClick={() => router.push('/live')}>Back to Live sessions</button></div>;
  if (!s || !pass) return <PageLoader />;
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => router.push('/live')} aria-label="Back"><ArrowLeft size={16} /></button>
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          <h1 className="text-lg font-bold text-ink-900">{s.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={copy}><Copy size={14} />Copy join link</button>
          <a className="btn btn-sm bg-[#25D366] text-white hover:brightness-95" href={`https://wa.me/?text=${encodeURIComponent(`Join today's training "${s.title}" here: ${joinUrl}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>
          <button type="button" className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={end}><Square size={14} />End session</button>
        </div>
      </div>
      <div className="min-h-0 flex-1"><JitsiRoom pass={pass} apiRef={api} onLeave={() => router.push('/live')} /></div>
    </div>
  );
}
