'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { ErrorText, PageHeader, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fmtMedium } from '@/lib/dates';

export default function ProfilePage() {
  const { profile, showToast } = useApp();
  const [managerName, setManagerName] = useState('');
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile.manager_id) return;
    sb().from('profiles').select('name').eq('id', profile.manager_id).single().then(({ data }) => setManagerName(data?.name || ''));
  }, [profile.manager_id]);

  const change = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.next.length < 6) { setError('Use at least 6 characters.'); return; }
    if (pw.next !== pw.confirm) { setError('The two passwords don’t match.'); return; }
    setSaving(true);
    const { error: err } = await sb().auth.updateUser({ password: pw.next });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setPw({ next: '', confirm: '' });
    showToast('Password changed.');
  };

  const fields = [
    ['Name', profile.name], ['Email', profile.email], ['Employee ID', profile.employee_id || '—'],
    ['Role', profile.role === 'manager' ? 'Manager' : 'Trainer'], ['Department', profile.department || '—'],
    ['Manager', profile.manager_id ? managerName || '…' : '—'], ['Account created', profile.created_at ? fmtMedium(profile.created_at.slice(0, 10)) : '—'],
    ['Status', profile.status === 'active' ? 'Active' : 'Inactive'],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel p-6 lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-800 font-display text-xl font-bold text-white">
              {profile.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div>
              <div className="font-display text-xl font-bold text-ink-900">{profile.name}</div>
              <div className="text-sm text-slate-500">{profile.email}</div>
            </div>
          </div>
          <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k} className="border-b border-slate-100 pb-3">
                <dt className="text-xs font-medium text-slate-400">{k}</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <form onSubmit={change} className="panel space-y-4 p-6">
          <h2 className="text-base font-bold">Change password</h2>
          <div><label className="label" htmlFor="p1">New password</label><input id="p1" type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></div>
          <div><label className="label" htmlFor="p2">Confirm new password</label><input id="p2" type="password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full" disabled={saving}>{saving && <Spinner size={16} />}Change password</button>
        </form>
      </div>
    </div>
  );
}
