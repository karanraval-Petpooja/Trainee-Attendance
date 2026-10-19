'use client';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { PageHeader } from '@/components/ui';
import { fmtMedium } from '@/lib/dates';
import { highlight, updatesFor } from '@/lib/whatsNew';

// Every guide for this person's role, newest first, with "Show me"
export default function WhatsNewPage() {
  const { profile } = useApp();
  const router = useRouter();
  const list = updatesFor(profile.role);
  return (
    <div>
      <PageHeader title="What’s new & guides" subtitle="Every feature added recently, with how to use it. Tap “Show me” to go to it." />
      <div className="space-y-3">
        {list.map((u) => (
          <section key={u.id} className="panel p-5">
            <div className="flex items-start gap-3">
              <div className="text-2xl">{u.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-ink-900">{u.title}</h2>
                  <span className="text-xs text-slate-400">{fmtMedium(u.date.slice(0, 10))}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{u.what}</p>
                {u.steps?.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">{u.steps.map((st, k) => <li key={k}>{st}</li>)}</ol>
                )}
              </div>
              {u.href && <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => { router.push(u.href); highlight(u.tour); }}>Show me</button>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
