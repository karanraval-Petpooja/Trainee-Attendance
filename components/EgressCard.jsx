'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { useApp } from './AppShell';

// Settings → Data usage: estimate of Supabase egress this billing cycle + who is warned, and when
export default function EgressCard() {
  const { settings, showToast, reloadSettings } = useApp();
  const [used, setUsed] = useState(null);
  const [start, setStart] = useState(null);
  const [form, setForm] = useState({ day: settings?.egress_cycle_day ?? 1, gb: settings?.egress_alert_gb ?? 2.5, email: settings?.egress_alert_email ?? 'karan.raval@petpooja.com' });
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [{ data: u }, { data: c }] = await Promise.all([sb().rpc('egress_used_gb'), sb().rpc('egress_cycle_start')]);
    setUsed(u ?? null); setStart(c ?? null);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true);
    const day = Math.max(1, Math.min(28, Number(form.day) || 1));
    const { error } = await sb().from('settings').update({ egress_cycle_day: day, egress_alert_gb: Number(form.gb) || 2.5, egress_alert_email: form.email.trim() }).eq('id', 1);
    setBusy(false);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Data-usage alert saved.'); reloadSettings?.(); load();
  };
  const pct = used != null ? Math.min(100, (used / 5) * 100) : 0;
  return (
    <section className="panel p-5">
      <h2 className="text-base font-bold">Data usage (Supabase egress)</h2>
      <p className="mt-1 text-sm text-slate-500">An estimate of the data the app has loaded from Supabase this billing cycle (free plan limit: 5 GB a month; it resets every cycle and no data is ever removed).</p>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-900">{used == null ? '—' : `${Number(used).toFixed(2)} GB`} <span className="font-normal text-slate-500">of 5 GB</span></span>
          {start && <span className="text-xs text-slate-500">since {fmtMedium(start)}</span>}
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${pct >= 70 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="eg-day">Billing cycle starts on day</label>
          <input id="eg-day" type="number" min="1" max="28" className="input" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></div>
        <div><label className="label" htmlFor="eg-gb">Alert at (GB)</label>
          <input id="eg-gb" type="number" min="0.5" max="5" step="0.5" className="input" value={form.gb} onChange={(e) => setForm({ ...form, gb: e.target.value })} /></div>
        <div><label className="label" htmlFor="eg-email">Notify (login email)</label>
          <input id="eg-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Checked every hour; one notification per cycle (in the app and on the phone). The cycle start day is on Supabase → Usage (“Current billing cycle”).</p>
        <button className="btn-primary btn-sm shrink-0" onClick={save} disabled={busy}>Save</button>
      </div>
    </section>
  );
}
