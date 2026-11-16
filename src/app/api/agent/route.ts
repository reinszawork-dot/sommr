import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { apiError, json } from '@/server/api';
import { maybeOne, query, sql } from '@/server/db';
import { env } from '@/server/env';
import { CITIES, getCity } from '@/lib/cities';
import { getCategories } from '@/server/services/categories';

export const dynamic = 'force-dynamic';

/**
 * Inbox for the owner's research agents (events scout, hidden-gems scout).
 * Everything lands as `pending` in Admin → Submissions; nothing is published
 * until the owner approves it. Auth: `Authorization: Bearer $AGENT_SECRET`.
 *
 * GET  → the categories and cities the agent may use.
 * POST → { kind: 'event', ... } or { kind: 'place', ... } (see schemas below).
 */

function authorised(req: Request): boolean {
  if (!env.AGENT_SECRET) return false;
  const a = Buffer.from(req.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${env.AGENT_SECRET}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const link = z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, 'must be a full https:// link');
const city = z.string().refine((s) => CITIES.some((c) => c.slug === s), 'unknown city slug');
// Roughly South Africa, so a bad coordinate can't put a pin in the ocean on another continent.
const lat = z.number().min(-35.5).max(-21.5);
const lng = z.number().min(16).max(33.5);

const eventSchema = z.object({
  kind: z.literal('event'),
  title: z.string().trim().min(3).max(200),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).optional(),
  venue_name: z.string().trim().min(2).max(200),
  address: z.string().trim().max(300).optional(),
  city_slug: city,
  category_slug: z.string(),
  source_url: link,
  ticket_url: link.optional(),
  description: z.string().trim().max(2000).optional(),
  is_free: z.boolean().optional(),
  price_min: z.number().min(0).max(100_000).optional(),
  // The organiser's own promo photos (direct https image links); the first becomes the cover.
  images: z.array(link.regex(/^https:\/\//i, 'images must be https links')).max(4).optional(),
});

const placeSchema = z.object({
  kind: z.literal('place'),
  name: z.string().trim().min(2).max(200),
  category_slug: z.string(),
  address: z.string().trim().min(5).max(300),
  city_slug: city,
  lat: lat.optional(),
  lng: lng.optional(),
  source_url: link,
  website: link.optional(),
  description: z.string().trim().max(1000).optional(),
});

const bodySchema = z.discriminatedUnion('kind', [eventSchema, placeSchema]);

export async function GET(req: Request) {
  if (!env.AGENT_SECRET) return apiError(503, 'AGENT_SECRET is not configured.');
  if (!authorised(req)) return apiError(401, 'Unauthorised');
  const cats = await getCategories();
  return json({
    eventCategories: cats.filter((c) => c.kind === 'event' && c.active).map((c) => ({ slug: c.slug, label: c.label })),
    placeCategories: cats.filter((c) => c.kind === 'place' && c.active).map((c) => ({ slug: c.slug, label: c.label })),
    cities: CITIES.map((c) => ({ slug: c.slug, name: c.name, province: c.province })),
  });
}

export async function POST(req: Request) {
  if (!env.AGENT_SECRET) return apiError(503, 'AGENT_SECRET is not configured.');
  if (!authorised(req)) return apiError(401, 'Unauthorised');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const v = parsed.data;
  if (!(await maybeOne(sql`select 1 from categories where slug = ${v.category_slug} and kind = ${v.kind}`))) {
    return apiError(400, `category_slug: not a ${v.kind} category (GET this endpoint for the list)`);
  }
  const c = getCity(v.city_slug)!;
  const note = `Found by agent. Source: ${v.source_url}`;

  if (v.kind === 'event') {
    const startsAt = new Date(v.starts_at);
    if (startsAt < new Date()) return apiError(400, 'starts_at: event is in the past');
    // Same title on the same SA day = already known (from any source, any status).
    const images = v.images ?? [];
    const dup = await maybeOne<{ id: string }>(sql`
      select id from events where lower(title) = lower(${v.title})
        and (starts_at at time zone 'Africa/Johannesburg')::date = (${startsAt}::timestamptz at time zone 'Africa/Johannesburg')::date`);
    if (dup) {
      // Known event: only fill in photos it doesn't have yet; never overwrite anything else.
      if (images.length) {
        await query(sql`update events set image_url = ${images[0]}, gallery = ${images.slice(1)}, updated_at = now()
          where id = ${dup.id} and image_url is null and not ('image_url' = any(locked_fields))`);
      }
      return json({ status: 'duplicate' });
    }
    await query(sql`
      insert into events (source, title, description, category_slug, starts_at, ends_at, venue_name, address, city_slug,
        is_free, price_min, ticket_url, source_url, image_url, gallery, status, review_note)
      values ('community', ${v.title}, ${v.description ?? null}, ${v.category_slug}, ${startsAt}, ${v.ends_at ? new Date(v.ends_at) : null},
        ${v.venue_name}, ${v.address ?? null}, ${c.slug}, ${v.is_free ?? null}, ${v.price_min ?? null},
        ${v.ticket_url ?? v.source_url}, ${v.source_url}, ${images[0] ?? null}, ${images.slice(1)}, 'pending', ${note})`);
    return json({ status: 'pending' }, { status: 201 });
  }

  // Same name in the same town = already known (OSM, admin or an earlier suggestion).
  const dup = await maybeOne(sql`select id from places where lower(name) = lower(${v.name}) and lower(coalesce(city, '')) = lower(${c.name})`);
  if (dup) return json({ status: 'duplicate' });
  await query(sql`
    insert into places (source, name, category_slug, lat, lng, address, city, website, description, status, review_note)
    values ('community', ${v.name}, ${v.category_slug}, ${v.lat ?? c.lat}, ${v.lng ?? c.lng}, ${v.address}, ${c.name},
      ${v.website ?? null}, ${v.description ?? null}, 'pending', ${note})`);
  return json({ status: 'pending' }, { status: 201 });
}
