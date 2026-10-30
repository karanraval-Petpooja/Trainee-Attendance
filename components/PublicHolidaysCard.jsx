'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';
import { useApp } from './AppShell';

// Settings → Public holidays: one calendar for everyone. On these days no attendance is needed
// (no reminders, no missed alerts) and the Monthly Sheet shows H (paid) for every trainee in training.
export default function PublicHolidaysCard() {
  const { settings, showToast, reloadSettings, now } = useApp();
  const [list, setList] = useState(() => [...(settings?.public_holidays || [])].sort((a, b) => (a.date < b.date ? -1 : 1)));
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (next, msg) => {
    setBusy(true);
    const { error } = await sb().from('settings').update({ public_holidays: next }).eq('id', 1);
    setBusy(false);
    if (error) { showToast(error.message, 'error'); return false; }
    setList(next); reloadSettings?.(); showToast(msg); return true;
  };
  const add = async () => {
    if (!date) return;
    if (list.some((h) => h.date === date)) { showToast('That date is already a holiday.', 'error'); return; }
    const next = [...list, { date, name: name.trim() || 'Public holiday' }].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (await save(next, `${fmtMedium(date)} added as a public holiday for everyone.`)) { setDate(''); setName(''); }
  };
  const remove = (d) => save(list.filter((h) => h.date !== d), `${fmtMedium(d)} removed from public holidays.`);
  const upcoming = list.filter((h) => h.date >= now.date);
  const past = list.filter((h) => h.date < now.date);
  const Row = ({ h }) => (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="w-28 font-semibold text-ink-900">{fmtMedium(h.date)}</span>
      <span className="flex-1 text-slate-700">{h.name}</span>
      <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => remove(h.date)} disabled={busy} aria-label={`Remove ${h.name}`}><Trash2 size={14} /></button>
    </li>
  );
  return (
    <section className="panel p-5">
      <h2 className="text-base font-bold">Public holidays</h2>
      <p className="mt-1 text-sm text-slate-500">The same for every trainer and trainee: no attendance is needed (no reminders or missed alerts), and the Monthly Sheet shows <b>H</b> (paid) for everyone in training that day. A holiday on a week off stays WO.</p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="ph-date">Date</label><input id="ph-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="min-w-[200px] flex-1"><label className="label" htmlFor="ph-name">Name</label><input id="ph-name" className="input" placeholder="e.g. Diwali" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></div>
        <button type="button" className="btn-primary" onClick={add} disabled={!date || busy}><Plus size={16} />Add holiday</button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Upcoming ({upcoming.length})</div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{upcoming.length ? upcoming.map((h) => <Row key={h.date} h={h} />) : <li className="px-3 py-2 text-sm text-slate-400">None yet</li>}</ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Past ({past.length})</div>
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">{past.length ? [...past].reverse().map((h) => <Row key={h.date} h={h} />) : <li className="px-3 py-2 text-sm text-slate-400">None</li>}</ul>
        </div>
      </div>
    </section>
  );
}
