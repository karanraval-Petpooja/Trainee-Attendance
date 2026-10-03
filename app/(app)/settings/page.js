'use client';
import { useState } from 'react';
import { useApp } from '@/components/AppShell';
import { ErrorText, PageHeader, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import DossierConnection from '@/components/DossierConnection';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];

function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <label htmlFor={id} className="font-semibold text-slate-800">{label}</label>
        {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
      </div>
      <button id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, reloadSettings, showToast } = useApp();
  const [f, setF] = useState({ ...settings, attendance_deadline: settings.attendance_deadline.slice(0, 5) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setF({ ...f, [k]: v });

  const save = async () => {
    const threshold = Number(f.escalation_threshold);
    if (!f.attendance_deadline) { setError('Set an attendance deadline.'); return; }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 30) { setError('Escalation threshold must be between 1 and 30.'); return; }
    if (!Number.isInteger(Number(f.edit_window_days)) || Number(f.edit_window_days) < 0) { setError('Edit window must be 0 or more days.'); return; }
    if (!/^[A-Za-z]{1,10}$/.test((f.batch_prefix || 'NHT').trim())) { setError('Batch code prefix must be letters only (e.g. NHT).'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await sb().from('settings').update({
      attendance_deadline: f.attendance_deadline,
      escalation_threshold: threshold,
      reminder_enabled: f.reminder_enabled,
      browser_notifications_enabled: f.browser_notifications_enabled,
      sunday_week_off: f.sunday_week_off,
      second_saturday_week_off: f.second_saturday_week_off,
      fourth_saturday_week_off: f.fourth_saturday_week_off,
      timezone: f.timezone,
      edit_window_days: Number(f.edit_window_days),
      batch_prefix: (f.batch_prefix || 'NHT').trim().toUpperCase(),
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    if (err) { setError(err.message); return; }
    await reloadSettings();
    showToast('Settings saved.');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Attendance settings" subtitle="These rules apply to every trainer and every date."
        actions={<button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}Save settings</button>} />
      <ErrorText>{error}</ErrorText>

      <section className="panel p-6">
        <h2 className="text-base font-bold">Deadline and escalation</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="s-deadline">Attendance deadline</label>
            <input id="s-deadline" type="time" className="input" value={f.attendance_deadline} onChange={(e) => set('attendance_deadline')(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-threshold">Escalation threshold</label>
            <input id="s-threshold" type="number" min={1} max={30} className="input" value={f.escalation_threshold} onChange={(e) => set('escalation_threshold')(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Days a trainer can miss marking before the manager is escalated</p>
          </div>
          <div>
            <label className="label" htmlFor="s-edit">Trainer edit window (days)</label>
            <input id="s-edit" type="number" min={0} max={60} className="input" value={f.edit_window_days} onChange={(e) => set('edit_window_days')(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Older saved entries can only be changed by a manager</p>
          </div>
          <div>
            <label className="label" htmlFor="s-prefix">Batch code prefix</label>
            <input id="s-prefix" className="input uppercase" maxLength={10} value={f.batch_prefix || 'NHT'} onChange={(e) => set('batch_prefix')(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">New batches get {(f.batch_prefix || 'NHT').toUpperCase()}01, {(f.batch_prefix || 'NHT').toUpperCase()}02 …</p>
          </div>
          <div>
            <label className="label" htmlFor="s-tz">Timezone</label>
            <select id="s-tz" className="input" value={f.timezone} onChange={(e) => set('timezone')(e.target.value)}>
              {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="panel divide-y divide-slate-100 px-6">
        <h2 className="py-4 text-base font-bold">Notifications</h2>
        <Toggle id="t-rem" label="Reminder" hint="Remind trainers in the hour before the deadline if any trainee is still unmarked." checked={f.reminder_enabled} onChange={set('reminder_enabled')} />
        <Toggle id="t-br" label="Browser notifications" hint="Show reminders and escalations as browser notifications while the app is open." checked={f.browser_notifications_enabled} onChange={set('browser_notifications_enabled')} />
      </section>

      <section className="panel divide-y divide-slate-100 px-6">
        <h2 className="py-4 text-base font-bold">Weekly off rules</h2>
        <Toggle id="t-sun" label="Sunday" hint="Every Sunday is a week off." checked={f.sunday_week_off} onChange={set('sunday_week_off')} />
        <Toggle id="t-2sat" label="2nd Saturday" hint="Calculated for every month automatically." checked={f.second_saturday_week_off} onChange={set('second_saturday_week_off')} />
        <Toggle id="t-4sat" label="4th Saturday" hint="Calculated for every month automatically." checked={f.fourth_saturday_week_off} onChange={set('fourth_saturday_week_off')} />
      </section>

      <DossierConnection />
    </div>
  );
}
