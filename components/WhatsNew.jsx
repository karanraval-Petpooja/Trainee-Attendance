'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { highlight, unseenUpdates } from '@/lib/whatsNew';
import { useApp } from './AppShell';

// After an update: a short guide with only what is new for this person's role, step by step, with "Show me".
export default function WhatsNew() {
  const { profile } = useApp();
  const router = useRouter();
  const list = useMemo(() => (profile ? unseenUpdates(profile.role, profile.whats_new_seen_at) : []), [profile]);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false); // after "Show me": a small "Next tip" pill
  const [done, setDone] = useState(false);

  useEffect(() => { if (list.length && !done) { const t = setTimeout(() => setOpen(true), 1200); return () => clearTimeout(t); } return undefined; }, [list.length, done]);

  const finish = async () => {
    setOpen(false); setPaused(false); setDone(true);
    try { await sb().rpc('mark_whats_new_seen'); } catch { /* shown again next time if it fails */ }
  };
  if (done || !list.length) return null;
  const u = list[i];
  const last = i === list.length - 1;
  const next = () => (last ? finish() : setI(i + 1));
  const showMe = () => {
    setOpen(false); setPaused(true);
    if (u.href) router.push(u.href);
    highlight(u.tour);
  };

  if (paused) {
    return (
      <div className="fixed bottom-20 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-2xl">
        <Sparkles size={15} className="text-emerald-300" />
        <span className="whitespace-nowrap">What’s new · {i + 1} of {list.length}</span>
        {last
          ? <button type="button" onClick={finish} className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-ink-900">Done</button>
          : <button type="button" onClick={() => { setPaused(false); setI(i + 1); setOpen(true); }} className="inline-flex items-center rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-ink-900">Next tip<ChevronRight size={14} /></button>}
        <button type="button" onClick={finish} className="rounded-full p-1 text-white/60 hover:bg-white/10" aria-label="Close"><X size={14} /></button>
      </div>
    );
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink-900/40 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-label="What's new">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-ink-900 px-5 py-3 text-white">
          <div className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} className="text-emerald-300" />What’s new</div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">{list.map((x, k) => <span key={x.id} className={`h-1.5 w-4 rounded-full ${k <= i ? 'bg-emerald-400' : 'bg-white/25'}`} />)}</div>
            <button type="button" onClick={finish} className="rounded-full p-1 text-white/70 hover:bg-white/10" aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        <div className="p-5">
          <div className="text-3xl">{u.icon}</div>
          <h2 className="mt-2 text-lg font-bold leading-snug text-ink-900">{u.title}</h2>
          <p className="mt-1.5 text-sm text-slate-600">{u.what}</p>
          {u.steps?.length > 0 && (
            <>
              <div className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">How to use it</div>
              <ol className="mt-2 space-y-2">
                {u.steps.map((st, k) => (
                  <li key={k} className="flex gap-3 text-sm text-slate-700">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-800">{k + 1}</span>
                    <span className="pt-0.5">{st}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-slate-400">{i + 1} of {list.length}</span>
          <div className="flex gap-2">
            {u.href && <button type="button" onClick={showMe} className="btn-secondary btn-sm">Show me</button>}
            <button type="button" onClick={next} className="btn-primary btn-sm">{last ? 'Got it' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
