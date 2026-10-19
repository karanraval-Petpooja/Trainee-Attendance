// The version of the app that is live right now (changes with every deployment)
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
}
