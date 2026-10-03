'use client';
import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { STATUS } from '@/lib/status';

export function Spinner({ className = '', size = 18 }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
      <Spinner /> {label}…
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-pop max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusChip({ status, late }) {
  const m = STATUS[status] || STATUS.upcoming;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${m.chip}`}>
      <span aria-hidden="true">{m.icon}</span>{m.short}{late && <span className="font-medium opacity-70">(late)</span>}
    </span>
  );
}

const TONES = {
  ink: 'text-ink-800', green: 'text-emerald-600', red: 'text-rose-600', amber: 'text-amber-600',
  sky: 'text-sky-600', orange: 'text-red-600', slate: 'text-slate-700', violet: 'text-ink-600',
};

export function StatCard({ label, value, tone = 'ink', hint, icon: Icon }) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between text-sm font-medium text-slate-500">
        {label}
        {Icon && <Icon size={16} className="text-slate-300" />}
      </div>
      <div className={`mt-2 font-display text-3xl font-bold tracking-tight ${TONES[tone]}`}>{value ?? '—'}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="font-semibold text-slate-700">{title}</div>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{children}</div>;
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
      {['present', 'absent', 'half_day', 'holiday', 'week_off', 'not_filled', 'pending'].map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5"><span aria-hidden="true">{STATUS[s].icon}</span>{STATUS[s].short}</span>
      ))}
    </div>
  );
}
