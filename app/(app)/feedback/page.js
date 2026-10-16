'use client';
import NhtFeedbackShare from '@/components/NhtFeedbackShare';
import { PageHeader } from '@/components/ui';

export default function NhtFeedbackPage() {
  return (
    <div>
      <PageHeader title="NHT Feedback Form" subtitle="When a batch finishes New Hire Training, every trainee fills this feedback form." />
      <section className="panel p-6"><NhtFeedbackShare /></section>
    </div>
  );
}
