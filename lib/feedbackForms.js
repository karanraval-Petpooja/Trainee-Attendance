// Feedback forms the trainers share with trainees (poster with QR code + link)
const msg = (what, url) => `Hi! Please share your feedback on the ${what} here: ${url}\nThank you! – Petpooja Learning & Development`;
export const FEEDBACK_FORMS = [
  { id: 'nht', label: 'NHT', name: 'NHT Feedback', url: 'https://forms.gle/JhB1hjwGAfT74YUdA', poster: '/feedback/nht.jpeg',
    when: 'At the end of New Hire Training.', message: `Hi! Your New Hire Training is complete. Please share your feedback on the training here: https://forms.gle/JhB1hjwGAfT74YUdA\nThank you! – Petpooja Learning & Development` },
  { id: 'sales', label: 'Sales', name: 'Sales Feedback', url: 'https://forms.gle/SapkX4rGrBw8FGTr5', poster: '/feedback/sales.jpeg',
    when: 'At the end of a Sales training.', message: msg('Sales training', 'https://forms.gle/SapkX4rGrBw8FGTr5') },
  { id: 'upskill', label: 'Upskill', name: 'Upskill Feedback', url: 'https://forms.gle/bUBi2fqjAjSpBBbc8', poster: '/feedback/upskill.jpeg',
    when: 'After an Upskill session.', message: msg('Upskill session', 'https://forms.gle/bUBi2fqjAjSpBBbc8'), sessionTypes: ['upskill'] },
  { id: 'ojt-pip', label: 'OJT / PIP', name: 'OJT / PIP Feedback', url: 'https://forms.gle/jgpDjkFYtKtaw5Gv8', poster: '/feedback/ojt-pip.jpeg',
    when: 'After an OJT or PIP session.', message: msg('OJT / PIP session', 'https://forms.gle/jgpDjkFYtKtaw5Gv8'), sessionTypes: ['ojt', 'pip'] },
];
export const formById = (id) => FEEDBACK_FORMS.find((f) => f.id === id) || FEEDBACK_FORMS[0];
export const formForSession = (type) => FEEDBACK_FORMS.find((f) => f.sessionTypes?.includes(String(type || '').toLowerCase())) || null;
