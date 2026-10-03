'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Pencil, Plus, Search, UserCheck, UserX } from 'lucide-react';
import { useApp } from '@/components/AppShell';
import { Empty, ErrorText, Modal, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { useAlerts, useTrainees, useTrainers } from '@/lib/hooks';
import { authFetch, sb } from '@/lib/supabase';
import { scopeTo, traineeActiveOn } from '@/lib/status';

function TrainerForm({ initial, managers, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isNew = !initial.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await authFetch('/api/trainers', { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(f) });
      onSaved(isNew ? 'Trainer added. Share the login details with them.' : 'Trainer updated.');
      onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal title={isNew ? 'Add trainer' : 'Edit trainer'} onClose={onClose} wide
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}{isNew ? 'Add trainer' : 'Save changes'}</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="f-name">Name</label><input id="f-name" className="input" value={f.name} onChange={set('name')} placeholder="Karan Raval" /></div>
        <div><label className="label" htmlFor="f-email">Login email</label><input id="f-email" type="email" className="input" value={f.email} onChange={set('email')} /></div>
        <div><label className="label" htmlFor="f-emp">Employee ID</label><input id="f-emp" className="input" value={f.employee_id || ''} onChange={set('employee_id')} placeholder="TRN-03" /><p className="mt-1 text-xs text-slate-400">Can also be used to log in</p></div>
        <div><label className="label" htmlFor="f-dept">Department</label><input id="f-dept" className="input" value={f.department || ''} onChange={set('department')} /></div>
        <div>
          <label className="label" htmlFor="f-mgr">Manager (receives escalations)</label>
          <select id="f-mgr" className="input" value={f.manager_id || ''} onChange={set('manager_id')}>
            <option value="">All managers</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {isNew && <div><label className="label" htmlFor="f-pw">Temporary password</label><input id="f-pw" className="input" value={f.password} onChange={set('password')} placeholder="At least 6 characters" /></div>}
      </div>
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

function ResetPassword({ trainer, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await authFetch('/api/trainers/reset-password', { method: 'POST', body: JSON.stringify({ id: trainer.id, password: pw }) });
      onDone(`Password reset for ${trainer.name}.`);
      onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal title="Reset password" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />}Reset password</button></>}>
      <p className="text-sm text-slate-600">Set a new password for <b>{trainer.name}</b>.</p>
      <input className="input mt-3" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" aria-label="New password" />
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
    </Modal>
  );
}

export default function TrainersPage() {
  const { profile, now, showToast } = useApp();
  const { trainers, loading, reload } = useTrainers({ includeInactive: true });
  const { trainees } = useTrainees();
  const ids = useMemo(() => trainers.map((t) => t.id), [trainers]);
  const { alerts } = useAlerts(ids);
  const [managers, setManagers] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [resetFor, setResetFor] = useState(null);

  useEffect(() => {
    sb().from('profiles').select('id,name').eq('role', 'manager').eq('status', 'active').order('name').then(({ data }) => setManagers(data || []));
  }, []);

  const missed = useMemo(() => alerts.reduce((m, a) => ({ ...m, [a.trainer_id]: (m[a.trainer_id] || 0) + 1 }), {}), [alerts]);
  const batch = (id) => scopeTo(trainees, id).filter((t) => traineeActiveOn(t, now.date)).length;
  const filtered = trainers.filter((t) => [t.name, t.email, t.employee_id].some((v) => v?.toLowerCase().includes(q.toLowerCase())));

  const toggle = async (t) => {
    const next = t.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !window.confirm(`Deactivate ${t.name}? They won’t be able to sign in.`)) return;
    try {
      await authFetch('/api/trainers', { method: 'PATCH', body: JSON.stringify({ id: t.id, status: next }) });
      showToast(next === 'inactive' ? 'Trainer deactivated.' : 'Trainer activated.');
      reload();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Trainers" subtitle="Trainers log in and mark attendance for their trainees."
        actions={<button className="btn-primary" onClick={() => setForm({ name: '', email: '', password: '', employee_id: '', department: '', manager_id: profile.id })}><Plus size={16} />Add Trainer</button>} />
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-10" placeholder="Search trainers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trainers" />
      </div>
      <div className="panel overflow-hidden">
        {loading ? <PageLoader /> : filtered.length === 0 ? <Empty title="No trainers yet">Add a trainer so they can start marking attendance.</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Employee ID</th><th>Trainees in training</th><th>Missed marking days</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className={t.status !== 'active' ? 'opacity-60' : ''}>
                    <td><div className="font-semibold text-slate-800">{t.name}</div><div className="text-xs text-slate-400">{t.email}</div></td>
                    <td className="text-slate-600">{t.employee_id || '—'}</td>
                    <td><Link href={`/trainees`} className="font-semibold text-ink-700 hover:underline">{batch(t.id)}</Link></td>
                    <td className="font-bold text-slate-700">{missed[t.id] || 0}</td>
                    <td><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${t.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{t.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/attendance?trainer=${t.id}`} className="btn-ghost btn-sm">Register</Link>
                        <button className="btn-ghost btn-sm" onClick={() => setForm({ ...t })} aria-label={`Edit ${t.name}`}><Pencil size={14} /></button>
                        <button className="btn-ghost btn-sm" onClick={() => setResetFor(t)} aria-label={`Reset password for ${t.name}`}><KeyRound size={14} /></button>
                        <button className="btn-ghost btn-sm" onClick={() => toggle(t)} aria-label={t.status === 'active' ? `Deactivate ${t.name}` : `Activate ${t.name}`}>
                          {t.status === 'active' ? <UserX size={14} className="text-red-600" /> : <UserCheck size={14} className="text-emerald-600" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <TrainerForm initial={form} managers={managers} onClose={() => setForm(null)} onSaved={(m) => { showToast(m); reload(); }} />}
      {resetFor && <ResetPassword trainer={resetFor} onClose={() => setResetFor(null)} onDone={(m) => showToast(m)} />}
    </div>
  );
}
