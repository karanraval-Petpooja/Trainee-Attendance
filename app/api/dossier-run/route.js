// The Dossier Google Sheet sync is switched off: trainees are updated only by uploading the Dossier file
// (Trainees & Batches → Upload Dossier sheet). Any old Google script trigger gets this answer.
export const dynamic = 'force-dynamic';
const off = () => Response.json({ ok: false, error: 'The Dossier Google Sheet sync is switched off. Upload the Dossier file in the app instead (Trainees & Batches → Upload Dossier sheet).' }, { status: 410 });
export async function GET() { return off(); }
export async function POST() { return off(); }
