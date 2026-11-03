# Sending LMS results to the Trainer Attendance app

**For:** the team that builds learn.petpooja.com
**Goal:** when a trainee finishes an assessment, the LMS tells the attendance app, so the result (pass / fail, score) shows up there straight away and the trainee's trainer gets a phone notification.

## 1. The call

```
POST https://attendance-five-sable.vercel.app/api/lms-result
Content-Type: application/json
x-lms-secret: <the secret you were given>
```

* Call it **from your server** (never from the browser: the secret must not be visible to users).
* Send it **every time an attempt is finished, pass or fail**.
* Use HTTPS only. Keep the secret in an environment variable, not in code.

## 2. Body (one result)

```json
{
  "attempt_id": "att_88231",
  "employee_code": "5601",
  "email": "aarav.mehta@petpooja.com",
  "name": "Aarav Mehta",
  "assessment": "NHT Final Assessment",
  "score": 43,
  "max_score": 50,
  "percentage": 86,
  "passed": true,
  "attempt": 1,
  "completed_at": "2026-11-03T14:32:10+05:30"
}
```

| Field | Required | Notes |
|---|---|---|
| `attempt_id` | **Strongly recommended** | Your unique id of this attempt. It makes retries safe: sending the same `attempt_id` again updates the result, it never creates a duplicate. |
| `employee_code` / `email` / `name` | **At least one** | How the app finds the trainee. Send **employee_code and email whenever you have them** (name alone is the weakest match). The email may be the official or the personal one. |
| `assessment` | **Yes** | Name of the course / test. The app groups results by this name, so keep it stable. |
| `passed` | **Yes** | `true` / `false`. Your LMS decides pass or fail, the app does not guess. (If you cannot send it, send `percentage` and `pass_percentage` instead.) |
| `score`, `max_score`, `percentage` | Recommended | `percentage` is calculated from score / max_score if you leave it out. |
| `attempt` | Optional | 1, 2, 3 … (default 1). |
| `completed_at` | Optional | ISO 8601 **with time zone** (default: now). |

Other field names are also understood (for example `emp_code`, `course`, `marks`, `total`, `result: "Passed"`), but the names above are the ones to use.

## 3. Several results at once (for example, old results)

```json
{ "results": [ { ...result 1... }, { ...result 2... } ] }
```

Up to **500 per request**. Send older results in pages of 500. Sending the same `attempt_id` twice is harmless.

## 4. Test the connection first (nothing is saved)

```bash
curl -X POST https://attendance-five-sable.vercel.app/api/lms-result \
  -H "Content-Type: application/json" -H "x-lms-secret: YOUR_SECRET" \
  -d '{"test": true}'
# → {"ok":true,"test":true,"message":"Connected. Nothing was saved."}
```

## 5. Answers

| HTTP | Meaning | What to do |
|---|---|---|
| `200` `{"ok":true,"saved":1,"rejected":[]}` | Saved. `rejected` lists any result that was invalid (with the reason). | Nothing. |
| `400` | The request is not valid (the reason is in `error` / `rejected`). | Fix the data; do not retry unchanged. |
| `401` | Wrong or missing secret. | Check the `x-lms-secret` header. |
| `500` / `503` / timeout | A temporary problem on our side. | **Retry** after a minute (safe: no duplicates). Retry up to a few times. |

## 6. Example (Node.js)

```js
async function sendResultToAttendanceApp(r) {
  const res = await fetch('https://attendance-five-sable.vercel.app/api/lms-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-lms-secret': process.env.ATTENDANCE_APP_SECRET },
    body: JSON.stringify({
      attempt_id: String(r.id), employee_code: r.user.employeeCode, email: r.user.email, name: r.user.name,
      assessment: r.course.title, score: r.score, max_score: r.maxScore, passed: r.passed,
      attempt: r.attemptNumber, completed_at: r.finishedAt.toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Attendance app answered ${res.status}: ${await res.text()}`); // → retry later
}
```

## 7. What the app does with it (for your information)

* Finds the trainee by employee code → email → exact name. A result it cannot match is kept and shown to a manager, who can link it by hand.
* The trainee's **final result** is the first pass; if they never passed, the latest attempt.
* New result → the trainee's trainer gets a notification ("passed" or "did not pass"). The app **does not** change the trainee's training status by itself.
