'use client';
import { useEffect, useState } from 'react';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fmtDateTime } from '@/lib/dates';
import { useApp } from './AppShell';

// Settings card: is the Dossier sync set up, and what did the last runs do?
export default function DossierConnection() {
  const { tz, showToast } = useApp();
  const [configured, setConfigured] = useState(null);
  const [runs, setRuns] = useState([]);
  const [secret, setSecret] = useState('');

  const load = async () => {
    fetch('/api/dossier-sync').then((r) => r.json()).then((j) => setConfigured(Boolean(j.configured))).catch(() => setConfigured(false));
    const { data } = await sb().from('sync_log').select('*').order('created_at', { ascending: false }).limit(60);
    const byRun = {};
    (data || []).forEach((x) => {
      const k = x.run_id || x.id;
      const r = (byRun[k] ||= { at: x.created_at, rows: 0, added: 0, updated: 0, days: 0, errors: [] });
      r.rows += x.rows_received; r.added += x.added; r.updated += x.updated; r.days += x.attendance_days;
      if (x.errors) r.errors.push(...x.errors.split('\n'));
      if (x.created_at > r.at) r.at = x.created_at;
    });
    setRuns(Object.values(byRun).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5));
  };
  useEffect(() => { load(); }, []);

  const makeSecret = () => {
    const s = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    setSecret(s);
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); showToast('Copied.'); } catch { showToast('Copy failed. Select and copy it manually.', 'error'); } };
  const last = runs[0];

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Dossier connection</h2>
          <p className="mt-1 text-sm text-slate-500">Copies trainees, RAG and attendance from the Dossier sheet automatically. The Dossier is only read, never changed.</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={load} aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3.5">
          <div className="text-xs font-semibold text-slate-500">Server secret</div>
          <div className={`mt-1 font-semibold ${configured ? 'text-emerald-700' : 'text-red-700'}`}>
            {configured === null ? 'Checking…' : configured ? '✓ DOSSIER_SYNC_SECRET is set' : '✗ DOSSIER_SYNC_SECRET is missing'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3.5">
          <div className="text-xs font-semibold text-slate-500">Last sync</div>
          {last ? (
            <div className="mt-1 text-sm">
              <span className="font-semibold text-slate-800">{fmtDateTime(last.at, tz)}</span>
              <span className="text-slate-500"> · {last.rows} rows, {last.added} added, {last.updated} updated, {last.days} attendance days</span>
              {last.errors.length > 0 && <div className="mt-1 text-xs text-amber-700">{last.errors.length} problem(s): {last.errors.slice(0, 2).join('; ')}</div>}
            </div>
          ) : <div className="mt-1 text-sm text-slate-500">Never</div>}
        </div>
      </div>

      {runs.length > 1 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink-700">Earlier syncs</summary>
          <ul className="mt-2 space-y-1 text-slate-600">
            {runs.slice(1).map((r) => <li key={r.at}>{fmtDateTime(r.at, tz)} · {r.rows} rows, {r.added} added, {r.updated} updated, {r.days} days{r.errors.length ? ` · ${r.errors.length} problem(s)` : ''}</li>)}
          </ul>
        </details>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <a href="/dossier-sync.gs" download className="btn-secondary btn-sm"><Download size={14} />Download Google script</a>
        <button className="btn-secondary btn-sm" onClick={makeSecret}>Generate a secret</button>
      </div>
      {secret && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{secret}</code>
            <button className="btn-ghost btn-sm" onClick={() => copy(secret)}><Copy size={14} />Copy</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Put this as <b>DOSSIER_SYNC_SECRET</b> in Vercel (and .env.local), redeploy, and paste the same text as SYNC_SECRET in the Google script.</p>
        </div>
      )}
    </section>
  );
}
