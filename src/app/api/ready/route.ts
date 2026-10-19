import { checkDatabase } from '@/server/db/readiness.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ready = await checkDatabase(process.env.DATABASE_URL);
  return Response.json(
    { status: ready ? 'ok' : 'unavailable' },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
