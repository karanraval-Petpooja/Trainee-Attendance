'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/supabase';
import { useApp } from './AppShell';
import { Spinner } from './ui';

// Runs the Google Dossier sync now: new trainees are added and given to their trainers
export default function SyncNowButton({ onDone, className = 'btn-secondary' }) {
  const { settings, profile, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  if (profile.role !== 'manager') return null; // manager only

  const run = async () => {
    if (!settings?.dossier_script_url) { showToast('Set the Google script web app URL first: Settings → Dossier connection.', 'error'); return; }
    setBusy(true);
    try {
      const r = await authFetch('/api/dossier-run', { method: 'POST' });
      if (r.busy || r.running) showToast(r.message);
      else {
        const parts = [`${r.added} new trainee${r.added === 1 ? '' : 's'} added`, `${r.updated} updated`];
        if (r.trainersChanged) parts.push(`${r.trainersChanged} trainer${r.trainersChanged === 1 ? '' : 's'} changed`);
        if (r.written?.rags) parts.push(`${r.written.rags} RAG / remark cell${r.written.rags === 1 ? '' : 's'} written`);
        showToast(`Synced: ${parts.join(', ')}.${r.errors?.length ? ` ${r.errors.length} problem(s): ${r.errors[0]}` : ''}`, r.errors?.length ? 'error' : 'success');
      }
      onDone?.();
    } catch (e) {
      showToast(e.message, 'error');
    }
    setBusy(false);
  };

  return (
    <button className={className} onClick={run} disabled={busy} title="Re-read the Dossier Sheet now: new trainees, trainer changes, emails, Emp Id, batches">
      {busy ? <Spinner size={16} /> : <RefreshCw size={16} />}{busy ? 'Syncing…' : 'Refresh from sheet'}
    </button>
  );
}
