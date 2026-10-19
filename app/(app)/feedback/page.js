'use client';
import { useEffect, useState } from 'react';
import NhtFeedbackShare from '@/components/NhtFeedbackShare';
import { PageHeader } from '@/components/ui';
import { FEEDBACK_FORMS } from '@/lib/feedbackForms';

// Feedback forms: NHT · Sales · Upskill · OJT / PIP — QR poster and link for each
export default function FeedbackPage() {
  const [tab, setTab] = useState('nht');
  useEffect(() => { const f = new URLSearchParams(window.location.search).get('form'); if (FEEDBACK_FORMS.some((x) => x.id === f)) setTab(f); }, []);
  return (
    <div>
      <PageHeader title="Feedback forms" subtitle="Show the QR code on screen, or send the link to the trainees." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {FEEDBACK_FORMS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={tab === f.id} onClick={() => setTab(f.id)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === f.id ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <section className="panel p-6"><NhtFeedbackShare key={tab} formId={tab} /></section>
    </div>
  );
}
