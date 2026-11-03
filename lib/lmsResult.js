// One result sent by the LMS (learn.petpooja.com) → a clean row. Tolerant about field names, strict about meaning:
// a result needs (1) an assessment name, (2) pass / fail, (3) a way to find the person (E Code, email or name).
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && str(o[k]) !== '') return o[k]; return undefined; };

function passedOf(o, pct) {
  const v = pick(o, 'passed', 'is_passed', 'pass', 'result', 'status', 'result_status');
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  if (/^(true|1|yes|pass|passed|cleared|completed with pass)$/.test(s)) return true;
  if (/^(false|0|no|fail|failed|not passed|not cleared)$/.test(s)) return false;
  const mark = num(pick(o, 'pass_percentage', 'pass_mark', 'passing_percentage', 'passing_score'));
  if (pct !== null && mark !== null) return pct >= mark;   // only when the LMS sent a pass mark but no verdict
  return undefined;
}

export function normalizeResult(o, i = 0) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: `#${i}: each result must be a JSON object` };
  const assessment = str(pick(o, 'assessment', 'assessment_name', 'course', 'course_name', 'test', 'test_name', 'exam', 'exam_name'));
  if (!assessment) return { error: `#${i}: "assessment" (the course / test name) is required` };
  const email = str(pick(o, 'email', 'employee_email', 'user_email', 'mail')).toLowerCase();
  const code = str(pick(o, 'employee_code', 'emp_code', 'e_code', 'ecode', 'emp_id', 'employee_id')).replace(/\.0$/, '');
  const name = str(pick(o, 'name', 'employee_name', 'full_name', 'user_name'));
  if (!(email.includes('@') || code || name)) return { error: `#${i}: send at least one of "employee_code", "email" or "name" so the person can be found` };

  const score = num(pick(o, 'score', 'marks', 'marks_obtained', 'obtained'));
  const max = num(pick(o, 'max_score', 'total', 'total_marks', 'out_of', 'max_marks'));
  let pct = num(pick(o, 'percentage', 'percent', 'score_percentage'));
  if (pct === null && score !== null && max !== null && max > 0) pct = (score / max) * 100;
  const passed = passedOf(o, pct);
  if (passed === undefined) return { error: `#${i}: "passed" (true / false) is required` };
  if (pct !== null && (pct < 0 || pct > 100)) pct = Math.max(0, Math.min(100, pct));

  const attempt = Math.max(1, Math.round(num(pick(o, 'attempt', 'attempt_no', 'attempt_number')) || 1));
  const when = new Date(str(pick(o, 'completed_at', 'completed_on', 'submitted_at', 'finished_at', 'date')) || Date.now());
  const completed_at = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const given = str(pick(o, 'attempt_id', 'result_id', 'external_id', 'id'));
  // no id from the LMS: build one from the facts, so sending the same attempt again still does not duplicate it
  const external_id = (given || [email || code || name.toLowerCase(), assessment.toLowerCase(), attempt, completed_at].join('|')).slice(0, 200);

  let raw = null;
  try { const j = JSON.stringify(o); if (j.length <= 20000) raw = o; } catch { raw = null; }
  return {
    row: {
      external_id, employee_code: code || null, email: email.includes('@') ? email : null, name: name || null, assessment: assessment.slice(0, 200),
      score, max_score: max, percentage: pct === null ? null : Math.round(pct * 100) / 100, passed, attempt, completed_at, raw,
    },
  };
}
