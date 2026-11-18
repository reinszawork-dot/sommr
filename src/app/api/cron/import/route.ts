import { timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';
import { runAllImports } from '@/server/events/importer';
import { importWikivoyage, wikivoyageDue } from '@/server/places/wikivoyage';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorised(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily event import. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`
 * (see vercel.json). Imports every enabled source, archives finished events and
 * geocodes venues without coordinates.
 */
export async function GET(req: Request) {
  if (!env.CRON_SECRET) return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  if (!authorised(req)) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const result = await runAllImports('cron');
  // Wikivoyage sights and activities change slowly: refresh every two weeks.
  const wikivoyage = (await wikivoyageDue()) ? await importWikivoyage().catch((e: Error) => ({ error: e.message })) : 'not due';
  return Response.json({ ...result, wikivoyage });
}
