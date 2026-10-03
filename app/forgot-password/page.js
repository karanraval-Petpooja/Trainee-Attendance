'use client';
import { useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import AuthFrame from '@/components/AuthFrame';
import { ErrorText, Spinner } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: err } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  };

  return (
    <AuthFrame>
      <h1 className="text-3xl font-bold tracking-tight">Reset your password</h1>
      {sent ? (
        <p className="mt-4 text-sm text-slate-600">If an account exists for <b>{email}</b>, a reset link is on its way. Open it on this device to choose a new password.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <p className="text-sm text-slate-500">Enter your work email and we’ll send you a reset link. You can also ask your manager to reset it.</p>
          <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full py-3" disabled={loading}>{loading && <Spinner size={16} />}Send reset link</button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-ink-700 hover:underline">Back to sign in</Link>
    </AuthFrame>
  );
}
