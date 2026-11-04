import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { sb } from '@/lib/supabase';
import { fmtDateTime, fmtMedium } from '@/lib/dates';

const STATUS_WORD = { present: 'Present', absent: 'Absent', half_day: 'Half Day', holiday: 'Holiday' };

// Who set this entry: a trainer / manager, the automatic Day 1 rule, or a Dossier import (by the manager who uploaded it)
export function markerText(rec, people) {
  if (!rec) return '';
  if (rec.source === 'auto_day1') return 'Auto · Day 1';
  const p = (people || {})[rec.marked_by];
  const who = p ? `${p.name}${p.role === 'manager' ? ' (manager)' : ''}` : rec.marked_by ? 'Removed user' : 'System';
  return rec.source === 'dossier' ? `${who} · Dossier import` : who;
}

const when = (iso, tz) => { try { return fmtDateTime(iso, tz); } catch { return String(iso || '—'); } };

// A problem while showing the log must never take the whole page down: show the reason inside the popup instead
class SafeBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error('Attendance log popup failed:', err); }
  render() {
    return this.state.err
      ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Could not show the log: {String(this.state.err?.message || this.state.err)}</p>
      : this.props.children;
  }
}

function LogBody({ row, people, tz }) {
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.resolve(sb().from('attendance_log').select('*').eq('trainee_id', row.t.id).eq('attendance_date', row.k).order('id'))
      .then((res) => {
        if (!live) return;
        if (res?.error) setError(res.error.message || 'The log could not be loaded.');
        setLog(Array.isArray(res?.data) ? res.data : []);
      })
      .catch((e) => { if (live) { setError(String(e?.message || e)); setLog([]); } });
    return () => { live = false; };
  }, [row.t.id, row.k]);

  if (log === null) return <div className="py-6 text-center"><Spinner /></div>;
  if (error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">The log could not be loaded: {error}</p>;
  if (log.length === 0) return <p className="text-sm text-slate-500">No changes were recorded for this day.</p>;
  return (
    <ol className="space-y-3">
      {log.map((l, i) => (
        <li key={l.id ?? i} className="rounded-xl border border-slate-100 p-3 text-sm">
          <div className="font-semibold text-slate-800">
            {l.old_status ? `${STATUS_WORD[l.old_status] || l.old_status} → ${STATUS_WORD[l.new_status] || l.new_status}` : `Marked ${STATUS_WORD[l.new_status] || l.new_status}`}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {markerText({ source: l.source, marked_by: l.changed_by }, people)} · {when(l.changed_at, tz)}{l.is_late && !l.old_status ? ' · late' : ''}
          </div>
          {l.note ? <div className="mt-1 text-xs text-slate-400">{String(l.note)}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function LogModal({ row, people, tz, onClose }) {
  return (
    <Modal title={`${row?.t?.name || 'Trainee'} · ${row?.k ? fmtMedium(row.k) : ''}`} onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}>
      <SafeBoundary><LogBody row={row} people={people} tz={tz} /></SafeBoundary>
    </Modal>
  );
}
