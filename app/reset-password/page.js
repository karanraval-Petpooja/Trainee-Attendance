'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import AuthFrame from '@/components/AuthFrame';
import { ErrorText, Spinner } from '@/components/ui';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const { data: sub } = sb().auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    sb().auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 6) { setError('Use at least 6 characters.'); return; }
    if (pw !== confirm) { setError('The two passwords don’t match.'); return; }
    setLoading(true);
    const { error: err } = await sb().auth.updateUser({ password: pw });
    setLoading(false);
    if (err) { setError(err.message); return; }
    router.replace('/dashboard');
  };

  return (
    <AuthFrame>
      <h1 className="text-3xl font-bold tracking-tight">Choose a new password</h1>
      {!ready ? (
        <p className="mt-4 text-sm text-slate-500">Open this page from the reset link in your email.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div><label className="label" htmlFor="pw">New password</label><input id="pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
          <div><label className="label" htmlFor="pw2">Confirm new password</label><input id="pw2" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full py-3" disabled={loading}>{loading && <Spinner size={16} />}Save password</button>
        </form>
      )}
    </AuthFrame>
  );
}
