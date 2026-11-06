'use client';
import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { fetchAll } from '@/lib/hooks';

// Feedback form responses for one form (RLS: a trainer gets only the feedback of the trainees they have or had, or that names
// them as trainer; a manager gets all). The answers are NOT loaded here (opened one by one) to keep downloads small.
// matched_name / matched_code / matched_batch (who the response is from, copied when it was linked) are read only when the
// database has them, so the report still works before supabase/update_feedback_matched.sql has been run.
let hasMatched; // checked once per page load
export function useFeedback(formId) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    if (hasMatched === undefined) hasMatched = !(await sb().from('feedback_responses').select('matched_name').limit(1)).error;
    setRows(await fetchAll(() => sb().from('feedback_responses')
      .select(`id, form_id, submitted_at, updated_at, rating, ratings, respondent_name, respondent_email, trainer_name, batch_code, trainee_id, trainer_id, match_via${hasMatched ? ', matched_name, matched_code, matched_batch' : ''}`)
      .eq('form_id', formId).order('submitted_at', { ascending: false, nullsFirst: false })));
    setLoading(false);
  }, [formId]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, loading, reload };
}
