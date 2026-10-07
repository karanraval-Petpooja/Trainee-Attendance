'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from './supabase';
import { scopeTo } from './status';

export async function fetchAll(build) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error || !data) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

// Attendance for a set of trainees in a date range → byTrainee[traineeId][date]
export function useAttendance(traineeIds, start, end) {
  const idKey = (traineeIds || []).filter(Boolean).join(',');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!idKey || !start || !end) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const ids = idKey.split(',');
    const out = [];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      out.push(...await fetchAll(() => sb().from('attendance').select('*')
        .in('trainee_id', chunk).gte('attendance_date', start).lte('attendance_date', end).order('attendance_date')));
    }
    setRows(out);
    setLoading(false);
  }, [idKey, start, end]);
  useEffect(() => { reload(); }, [reload]);
  const byTrainee = useMemo(() => {
    const m = {};
    rows.forEach((r) => { (m[r.trainee_id] ||= {})[r.attendance_date] = r; });
    return m;
  }, [rows]);
  return { rows, byTrainee, loading, reload };
}

// Batches visible to this user
export function useBatches() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setBatches(await fetchAll(() => sb().from('batches').select('*').order('code')));
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { batches, loading, reload };
}

// Trainees visible to this user (RLS: trainer → trainees they have or had, manager → all).
// Each trainee carries its batch (_batch) and its trainer history (_assign).
// trainerId limits the list to that trainer's days (see scopeTo).
// Deleted trainees are hidden unless includeDeleted (reports keep them).
export function useTrainees({ includeInactive = false, includeDeleted = false, trainerId = null } = {}) {
  const [raw, setRaw] = useState([]);
  const [assign, setAssign] = useState([]);
  const [loading, setLoading] = useState(true);
  const { batches, loading: bLoading, reload: reloadBatches } = useBatches();
  const reload = useCallback(async () => {
    setLoading(true);
    const [data, a] = await Promise.all([
      fetchAll(() => {
        let q = sb().from('trainees').select('*').order('name');
        if (!includeInactive) q = q.eq('status', 'active');
        if (!includeDeleted) q = q.is('deleted_at', null);
        return q;
      }),
      fetchAll(() => sb().from('trainee_assignments').select('*').order('start_date')),
    ]);
    setRaw(data);
    setAssign(a);
    setLoading(false);
  }, [includeInactive, includeDeleted]);
  useEffect(() => { reload(); }, [reload]);
  const trainees = useMemo(() => {
    const bmap = Object.fromEntries(batches.map((b) => [b.id, b]));
    const amap = {};
    assign.forEach((x) => { (amap[x.trainee_id] ||= []).push(x); });
    const list = raw.map((t) => ({ ...t, _batch: t.batch_id ? bmap[t.batch_id] || null : null, _assign: amap[t.id] || null }));
    return scopeTo(list, trainerId);
  }, [raw, assign, batches, trainerId]);
  const reloadAll = useCallback(() => { reload(); reloadBatches(); }, [reload, reloadBatches]);
  return { trainees, batches, loading: loading || bLoading, reload: reloadAll };
}

// Trainer accounts (manager view)
export function useTrainers({ includeInactive = false } = {}) {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    let q = sb().from('profiles').select('*').eq('role', 'trainer').order('name');
    if (!includeInactive) q = q.eq('status', 'active');
    const { data } = await q;
    setTrainers(data || []);
    setLoading(false);
  }, [includeInactive]);
  useEffect(() => { reload(); }, [reload]);
  return { trainers, loading, reload };
}

// Missed-marking alerts (per trainer, per batch, per day)
export function useAlerts(trainerIds) {
  const idKey = (trainerIds || []).filter(Boolean).join(',');
  const [alerts, setAlerts] = useState([]);
  const reload = useCallback(async () => {
    if (!idKey) { setAlerts([]); return; }
    setAlerts(await fetchAll(() => sb().from('attendance_alerts').select('*, batch:batches(code)')
      .in('trainer_id', idKey.split(',')).order('attendance_date', { ascending: false })));
  }, [idKey]);
  useEffect(() => { reload(); }, [reload]);
  return { alerts, reload };
}
