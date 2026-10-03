'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { sb } from '@/lib/supabase';
import AuthFrame from '@/components/AuthFrame';
import { ErrorText, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hasUsers, setHasUsers] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [setup, setSetup] = useState({ name: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    sb().auth.getSession().then(({ data }) => { if (data.session) router.replace('/dashboard'); });
    if (new URLSearchParams(window.location.search).get('inactive')) setError('Your account is inactive. Contact your manager.');
    setRemember(window.localStorage.getItem('ta_remember') !== '0');
    sb().rpc('app_has_users').then(({ data, error: e }) => { if (!e) setHasUsers(!!data); });
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      window.localStorage.setItem('ta_remember', remember ? '1' : '0');
      let email = identifier.trim();
      if (!email.includes('@')) {
        const { data } = await sb().rpc('resolve_login', { p_identifier: email });
        if (!data) throw new Error('No active account uses that Employee ID.');
        email = data;
      }
      const { error: err } = await sb().auth.signInWithPassword({ email, password });
      if (err) throw new Error(err.message === 'Invalid login credentials' ? 'Email/Employee ID or password is incorrect.' : err.message);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const createManager = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setup) });
    const j = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) { setError(j.error || 'Could not create the account.'); return; }
    setHasUsers(true);
    setIdentifier(j.email);
    setPassword(setup.password);
    setNotice('Manager account created. Sign in below.');
  };

  const seed = async () => {
    setSeeding(true);
    setError('');
    const res = await fetch('/api/seed', { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setSeeding(false);
    if (!res.ok) { setError(j.error || 'Demo data could not be loaded.'); return; }
    setHasUsers(true);
    setIdentifier(j.accounts.manager);
    setPassword(j.accounts.password);
    setNotice(`Demo data loaded. Manager: ${j.accounts.manager}, trainer: ${j.accounts.trainer}, password: ${j.accounts.password}`);
  };

  return (
    <AuthFrame>
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-slate-500">Use your work email or Employee ID.</p>

      {!hasUsers && (
        <div className="mt-6 rounded-2xl border border-ink-200 bg-white p-4">
          <div className="font-semibold text-ink-900">Set up the app</div>
          <p className="mt-1 text-sm text-slate-500">Create the first manager account. You can add trainers after signing in.</p>
          <form onSubmit={createManager} className="mt-3 space-y-2.5">
            <input className="input" placeholder="Your name" value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} aria-label="Your name" />
            <input className="input" type="email" placeholder="Work email" value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} aria-label="Work email" />
            <input className="input" type="password" placeholder="Password (6+ characters)" value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} aria-label="Password" autoComplete="new-password" />
            <button className="btn-primary btn-sm w-full" disabled={creating}>{creating && <Spinner size={14} />}Create manager account</button>
          </form>
          <button className="mt-3 text-xs font-semibold text-slate-500 hover:underline" onClick={seed} disabled={seeding}>{seeding ? 'Loading demo data…' : 'Or load demo data to try the app'}</button>
        </div>
      )}
      {notice && <div className="mt-6 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">{notice}</div>}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="identifier">Email / Employee ID</label>
          <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required placeholder="name@company.com" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} className="input pr-11" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-slate-600">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-ink-800" />
            Remember me
          </label>
          <Link href="/forgot-password" className="font-semibold text-ink-700 hover:underline">Forgot password?</Link>
        </div>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn-primary w-full py-3" disabled={loading}>{loading && <Spinner size={16} />}Login</button>
      </form>

      {process.env.NEXT_PUBLIC_SHOW_DEMO_HINT === 'true' && hasUsers && !notice && (
        <p className="mt-6 text-xs leading-relaxed text-slate-400">Demo: manager@demo.com or karan@demo.com, password Demo@123</p>
      )}
    </AuthFrame>
  );
}
