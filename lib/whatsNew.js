// "What's new". Newest first. Every entry is on the "What's new & guides" page for its roles.
// Only entries with popup: [...roles] also POP UP once after they go live — keep that for major,
// useful-to-the-user changes (today: trainers only). Minor changes: no popup.
//   roles: ['trainer'] / ['manager'] / ['trainer', 'manager']
//   href + tour: "Show me" opens that page and highlights the element with data-tour="<tour>"
export const UPDATES = [
  {
    id: 'public-holidays', date: '2026-10-31T13:00:00+05:30', roles: ['manager'], icon: '🎉',
    title: 'One public holiday calendar for everyone',
    what: 'Add public holidays once in Settings. On those days no attendance is needed for anyone, and the Monthly Sheet shows H (paid) for every trainee in training, whoever downloads it.',
    steps: ['Settings → Public holidays → choose the date, type the name → Add holiday.', 'Remove one with the bin icon if plans change.'],
    href: '/settings',
  },
  {
    id: 'report-access', date: '2026-10-31T12:00:00+05:30', roles: ['manager'], icon: '🔑',
    title: 'Give one trainer the right to take reports for all trainees',
    what: 'That trainer can see and download every trainee’s attendance (Monthly Sheet, Attendance History) to share with HR. It is read-only: they still mark only their own trainees.',
    steps: ['Trainers → switch on “Reports (all trainees)” for the trainer.', 'They get a notification; in Reports they can choose All trainers and download the Excel for HR.', 'Switch it off any time.'],
    href: '/trainers',
  },
  {
    id: 'monthly-rules-oct', date: '2026-10-30T12:00:00+05:30', roles: ['manager', 'trainer'], icon: '🧾',
    title: 'Monthly Sheet: handover day, E Codes from Contact Details, DOJ revised at the end',
    what: 'Handover shows the day after the TCD (also on a week off), or on the TCD itself when it is the last day of the month. E Codes are looked up by email in Contact Details (Active and Left); a name-only match is yellow and noted in Remarks. DOJ Revised and Offer Revoked rows are listed at the end.',
    steps: ['Reports → Monthly Sheet.', 'Check yellow E Codes against Contact Details.', '“Several months” starts from last month by default.'],
    href: '/reports',
  },
  {
    id: 'monthly-several-months', date: '2026-10-29T12:00:00+05:30', roles: ['manager', 'trainer'], icon: '📊',
    title: 'Monthly Sheet: several months in one Excel',
    what: 'Download a range of months in one file: a Summary tab with paid days per month for each trainee, then one tab per month.',
    steps: ['Reports → Monthly Sheet → “Several months”: choose From and To.', 'Tap “Download months”. The filters on the page apply to every month.'],
    href: '/reports',
  },
  {
    id: 'session-attendance-optional', date: '2026-10-20T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '🎚️',
    title: 'Upskill / Refresher: push without taking attendance',
    what: 'When uploading an Upskill or Refresher session, switch “Take attendance” off to skip the attendance part and go straight to Push to Training Log.',
    steps: [
      'OJT / Upskill / PIP / Refresher → Upload sheet → choose the Meet file.',
      'Type: Upskill or Refresher → switch “Take attendance” off.',
      'Save → the Push window opens; everyone in the file is pushed as Completed.',
    ],
  },
  {
    id: 'feedback-forms', date: '2026-10-19T12:00:00+05:30', roles: ['trainer', 'manager'], popup: ['trainer'], icon: '📝',
    title: 'Feedback forms for NHT, Sales, Upskill and OJT / PIP',
    what: 'Each training type now has its own feedback form with a QR poster, ready to show or send to trainees.',
    steps: [
      'Tap “Feedback” at the top of any page and choose the tab: NHT, Sales, Upskill or OJT / PIP.',
      'Show the QR code on screen, or tap Share / WhatsApp / Copy link to send it to the trainees.',
      'On an Upskill or OJT / PIP session page, the “Feedback form” button opens the right form straight away.',
    ],
    href: '/feedback', tour: 'nht-feedback',
  },
  {
    id: 'two-step-handover-trainer', date: '2026-10-19T00:00:00+05:30', roles: ['trainer'], popup: ['trainer'], icon: '✅',
    title: 'Training complete: tell your manager the batch is on the floor',
    what: 'When your trainees finish training and go to the floor, mark them “Training complete”. Reminders and missed-attendance alerts stop; your manager confirms the final handover.',
    steps: [
      'Open Trainees & Batches.',
      'On a trainee, tap “Training complete” — or tick the whole batch and tap “Training complete” in the bar at the top.',
      'Choose the date they went to the floor and tap Confirm.',
      'The trainee shows “Sent to floor · awaiting manager”. You can Undo until your manager confirms.',
    ],
    href: '/trainees', tour: 'training-complete',
  },
  {
    id: 'two-step-handover-manager', date: '2026-10-19T00:00:00+05:30', roles: ['manager'], icon: '✅',
    title: 'Confirm handovers your trainers completed',
    what: 'Trainers now mark “Training complete” when a batch goes to the floor. You get a notification and confirm the final handover.',
    steps: [
      'On the Dashboard, the card “Awaiting final handover” lists them by batch and trainer.',
      'Tap “Review & confirm” (or Trainees → Status → Awaiting final handover).',
      'Select the trainees → Handover. The date is already the trainer’s date → Confirm handover.',
      '“Overdue” now only shows trainees whose trainer has not finished yet — your real pending list.',
    ],
    href: '/trainees?show=awaiting', tour: 'status-filter',
  },
  {
    id: 'deadline-end-of-day', date: '2026-10-19T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '⏰',
    title: 'Attendance marked during the day is on time',
    what: 'With the 12:00 AM deadline, anything marked the same day is on time. Only marking a past day shows “late”. Earlier same-day entries were corrected.',
    steps: ['Mark attendance any time during the day as usual.', 'The reminder now comes between 11 PM and midnight if something is still unmarked.'],
  },
  {
    id: 'update-now', date: '2026-10-18T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '🔄',
    title: '“Update now” when a new version is out',
    what: 'When the app is updated, a bar appears at the bottom: “A new version is ready”.',
    steps: ['Tap “Update now”. The app reloads with the latest version — nothing you saved is lost.', 'Your app version is shown at the bottom of the Profile page.'],
  },
  {
    id: 'phone-notifications', date: '2026-10-18T00:00:00+05:30', roles: ['trainer', 'manager'], popup: ['trainer'], icon: '🔔',
    title: 'Get attendance reminders on your phone',
    what: 'Never miss marking attendance: reminders and alerts pop up on your phone, even when the app is closed.',
    steps: [
      'Install the app: Android → Chrome → “Install app”; iPhone → Safari → Share → Add to Home Screen.',
      'Open the app from its icon and go to Notifications → “Phone notifications” → Turn on → Allow.',
      'A test notification arrives within seconds. Use “Send a test” any time.',
    ],
    href: '/notifications', tour: 'phone-notifications',
  },
  {
    id: 'phone-app', date: '2026-10-17T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '📱',
    title: 'Install the app on your phone',
    what: 'Trainer Attendance can be installed like an app on Android and iPhone — no Play Store or App Store needed.',
    steps: [
      'Android: open the app link in Chrome → tap “Install app” (top bar) or ⋮ → Install app.',
      'iPhone: open the app link in Safari → Share → Add to Home Screen.',
      'Open it from the new “Attendance” icon: full screen, same login, same data.',
    ],
    href: '/dashboard', tour: 'install-app',
  },
  {
    id: 'nht-feedback', date: '2026-10-16T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '📝',
    title: 'NHT feedback form, one tap away',
    what: 'At the end of New Hire Training, share the feedback form with your batch.',
    steps: ['Tap “NHT Feedback” at the top of any page.', 'Show the QR on screen, or Share / WhatsApp / Copy the link to the trainees.'],
    href: '/feedback', tour: 'nht-feedback',
  },
  {
    id: 'who-and-why', date: '2026-10-16T00:00:00+05:30', roles: ['trainer', 'manager'], icon: '🔎',
    title: 'See who is not on a day’s register — and why',
    what: 'Below the attendance list: trainees connected to that day who are not on the register, with the reason (Handover, Resigned, Sent to floor, With another trainer…).',
    steps: ['Open Mark Attendance (or a day in the Date-wise Calendar).', 'Scroll to the bottom and tap “Show who and why”.'],
    href: '/attendance', tour: 'who-and-why',
  },
  {
    id: 'status-filters', date: '2026-10-15T00:00:00+05:30', roles: ['manager'], icon: '🗂️',
    title: 'Overdue, Awaiting handover and every training status as filters',
    what: 'Filter trainees by Overdue (past probable handover), Awaiting final handover, Retraining, or any status like Resigned or Drop Out — together with batch and trainer.',
    steps: ['Open Trainees & Batches.', 'Use the Status box (with All batches / All trainers next to it).'],
    href: '/trainees', tour: 'status-filter',
  },
  {
    id: 'dossier-upload', date: '2026-10-15T00:00:00+05:30', roles: ['manager'], icon: '📤',
    title: 'Update trainees by uploading the Dossier file',
    what: 'Statuses and dates come from the Dossier file you upload. Attendance, RAG, trainer switches and batch moves made in the app are never changed.',
    steps: ['Download the Dossier sheet as Excel (File → Download → Microsoft Excel).', 'Trainees & Batches → “Upload Dossier sheet” → choose the file → check the trainer chips → Import.'],
    href: '/trainees', tour: 'upload-dossier',
  },
  {
    id: 'failed-retraining', date: '2026-10-14T00:00:00+05:30', roles: ['manager'], icon: '🔁',
    title: 'Failed → Retraining, second fail → Not Certified',
    what: 'In the Handover window choose “Failed”: a first fail starts a retraining period (trainer / batch can change); a second fail removes the trainee as Not Certified.',
    steps: ['Trainees & Batches → Handover on the trainee → Outcome “Failed”.', 'Check the coloured box (1st or 2nd fail), set the retraining start if asked → Confirm.'],
    href: '/trainees', tour: 'handover',
  },
];

// Pop-up entries this person has not seen yet (major changes only)
export function unseenUpdates(role, seenAt) {
  const since = seenAt ? new Date(seenAt).getTime() : Date.now() - 21 * 86400000;
  return UPDATES.filter((u) => u.popup?.includes(role) && new Date(u.date).getTime() > since);
}
export const updatesFor = (role) => UPDATES.filter((u) => u.roles.includes(role));

// "Show me": wait for the element on the page, scroll to it and make it glow for a few seconds
export function highlight(tour) {
  if (!tour) return;
  let tries = 0;
  const find = () => {
    const el = document.querySelector(`[data-tour="${tour}"]`);
    if (!el) { if (tries++ < 25) setTimeout(find, 200); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('tour-glow');
    setTimeout(() => el.classList.remove('tour-glow'), 6000);
  };
  setTimeout(find, 300);
}
