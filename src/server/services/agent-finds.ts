import 'server-only';
import { CITIES } from '@/lib/cities';
import { isTicketSite } from '@/lib/tickets';
import { similarTitles } from '@/lib/titles';
import { maybeOne, query, sql } from '../db';
import type { SqlFragment } from '../sql';
import { env } from '../env';
import { geocodeOne } from '../geocode';

type Pin = { lat: number; lng: number };

/** Geoapify first when configured (reliable from Vercel), then the cached Nominatim lookup. */
export async function pinAddress(text: string): Promise<Pin | null> {
  if (env.GEOAPIFY_API_KEY) {
    try {
      const url = new URL('https://api.geoapify.com/v1/geocode/search');
      url.searchParams.set('text', text.slice(0, 200));
      url.searchParams.set('filter', 'countrycode:za');
      url.searchParams.set('limit', '1');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      const hit = res.ok ? ((await res.json()) as { results?: { lat: number; lon: number }[] }).results?.[0] : undefined;
      if (hit) return { lat: hit.lat, lng: hit.lon };
    } catch {}
  }
  try {
    return await geocodeOne(text);
  } catch {
    return null;
  }
}

/**
 * Publish everything the owner's research agents filed (pending, review note "Found by agent").
 * Places parked on their town centre get a real pin from their address first; any that can't
 * be pinned near their town stay pending, so no place is shown in the wrong spot.
 */
export async function publishAgentFinds(pin: (text: string) => Promise<Pin | null> = pinAddress) {
  const events = await query<{ id: string }>(sql`
    update events set status = 'published', updated_at = now()
    where status = 'pending' and review_note like 'Found by agent%' returning id`);
  const places = await query<{ id: string; name: string; address: string | null; city: string | null; lat: number; lng: number }>(sql`
    select id, name, address, city, lat, lng from places where status = 'pending' and review_note like 'Found by agent%'`);
  let published = 0;
  let unpinned = 0;
  for (const p of places) {
    const town = CITIES.find((c) => c.name === p.city);
    const onTownCentre = town && Math.abs(p.lat - town.lat) < 1e-6 && Math.abs(p.lng - town.lng) < 1e-6;
    let spot: Pin | null = { lat: p.lat, lng: p.lng };
    if (onTownCentre) spot = (await pin(`${p.name}, ${p.address ?? ''}`)) ?? (p.address ? await pin(p.address) : null);
    // Must be in South Africa and within ~60 km of its town.
    const ok = spot && spot.lat >= -35.5 && spot.lat <= -21.5 && spot.lng >= 16 && spot.lng <= 33.5
      && (!town || Math.hypot(spot.lat - town.lat, spot.lng - town.lng) < 0.6);
    if (!ok) {
      unpinned++;
      continue;
    }
    await query(sql`update places set lat = ${spot!.lat}, lng = ${spot!.lng}, status = 'published', updated_at = now() where id = ${p.id}`);
    published++;
  }
  return { events: events.length, places: published, unpinned };
}

// ───────────────────────────── Fix suggestions from the freshness checker ─────────────────────────────

/** What a fix may change, per target. Anything else in a suggestion is ignored. */
export const FIX_FIELDS = {
  event: ['status', 'sold_out', 'starts_at', 'ends_at', 'time_tbc', 'ticket_url', 'venue_name'],
  place: ['status', 'website'],
} as const;

export interface FixRow {
  id: string;
  target: 'event' | 'place';
  target_id: string;
  changes: Record<string, unknown>;
  reason: string;
  source_url: string | null;
}

/** Apply one pending fix. Fields an admin has locked are left alone. Returns false if it no longer applies. */
export async function applyFix(fixId: string): Promise<boolean> {
  const fix = await maybeOne<FixRow & Record<string, unknown>>(sql`select id, target, target_id, changes, reason, source_url from agent_fixes where id = ${fixId} and status = 'pending'`);
  if (!fix) return false;
  const table = sql.raw(fix.target === 'event' ? 'events' : 'places');
  const row = await maybeOne<{ locked_fields: string[] }>(sql`select locked_fields from ${table} where id = ${fix.target_id}`);
  if (!row) {
    await query(sql`update agent_fixes set status = 'dismissed' where id = ${fix.id}`);
    return false;
  }
  const allowed: readonly string[] = FIX_FIELDS[fix.target];
  const sets: SqlFragment[] = [];
  for (const [key, value] of Object.entries(fix.changes)) {
    if (!allowed.includes(key) || row.locked_fields.includes(key)) continue;
    if (key === 'status' && value !== (fix.target === 'event' ? 'cancelled' : 'hidden')) continue;
    const v = key === 'starts_at' || key === 'ends_at' ? new Date(String(value)) : value;
    if (v instanceof Date && Number.isNaN(v.getTime())) continue;
    sets.push(sql`${sql.raw(key)} = ${v}`);
  }
  if (sets.length) await query(sql`update ${table} set ${sql.join(sets)}, updated_at = now() where id = ${fix.target_id}`);
  await query(sql`update agent_fixes set status = 'applied' where id = ${fix.id}`);
  return true;
}

// ───────────────────────────── Duplicate events ─────────────────────────────

export interface DupEvent {
  id: string;
  title: string;
  starts_at: Date;
  city_slug: string | null;
  image_url: string | null;
  ticket_url: string | null;
  description: string | null;
  featured: boolean;
  status: string;
  created_at: Date;
}

const saDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

/** Best copy first: featured, a real ticket link, photos, a description, already published, then the oldest. */
function score(e: DupEvent): number {
  return (e.featured ? 8 : 0) + (isTicketSite(e.ticket_url) ? 4 : 0) + (e.image_url ? 2 : 0) + (e.description ? 1 : 0) + (e.status === 'published' ? 1 : 0);
}

/** Groups of listings for the same event: same SA day, same town, same or near-identical title. Keeper first. */
export function groupDuplicates(events: DupEvent[]): DupEvent[][] {
  const groups: DupEvent[][] = [];
  for (const e of events) {
    const g = groups.find((grp) => {
      const k = grp[0];
      return saDate(k.starts_at) === saDate(e.starts_at) && k.city_slug === e.city_slug
        && (k.title.toLowerCase() === e.title.toLowerCase() || similarTitles(k.title, e.title));
    });
    if (g) g.push(e);
    else groups.push([e]);
  }
  return groups
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => score(b) - score(a) || a.created_at.getTime() - b.created_at.getTime()));
}

export async function findDuplicateGroups(): Promise<DupEvent[][]> {
  const rows = await query<DupEvent & Record<string, unknown>>(sql`
    select id, title, starts_at, city_slug, image_url, ticket_url, description, featured, status, created_at from events
    where status in ('published', 'pending') and coalesce(ends_at, starts_at + interval '6 hours') > now()
    order by starts_at`);
  return groupDuplicates(rows);
}

/**
 * Keep the best listing: it takes over photos, a ticket link and a description it lacks, and anyone who
 * saved a copy keeps it saved. The other copies are set aside as rejected duplicates (not deleted).
 */
export async function mergeDuplicates(keepId: string, dropIds: string[]): Promise<void> {
  const drops = dropIds.filter((d) => d !== keepId);
  if (!drops.length) return;
  await query(sql`
    update events k set
      image_url = coalesce(k.image_url, (select d.image_url from events d where d.id = any(${drops}) and d.image_url is not null limit 1)),
      gallery = case when cardinality(k.gallery) = 0 then coalesce((select d.gallery from events d where d.id = any(${drops}) and cardinality(d.gallery) > 0 limit 1), k.gallery) else k.gallery end,
      description = coalesce(k.description, (select d.description from events d where d.id = any(${drops}) and d.description is not null limit 1)),
      updated_at = now()
    where k.id = ${keepId}`);
  const ticket = await maybeOne<{ ticket_url: string }>(sql`select ticket_url from events where id = any(${drops}) and ticket_url is not null`);
  const keep = await maybeOne<{ ticket_url: string | null }>(sql`select ticket_url from events where id = ${keepId}`);
  if (ticket && !isTicketSite(keep?.ticket_url) && isTicketSite(ticket.ticket_url)) {
    await query(sql`update events set ticket_url = ${ticket.ticket_url} where id = ${keepId}`);
  }
  await query(sql`insert into saved_events (user_id, event_id) select user_id, ${keepId} from saved_events where event_id = any(${drops}) on conflict do nothing`);
  await query(sql`update events set status = 'rejected', review_note = ${'Duplicate of ' + keepId}, updated_at = now() where id = any(${drops})`);
}

// ───────────────────────────── Rejections (agents read these to learn) ─────────────────────────────

export const REJECT_REASONS = [
  'Not a real or confirmed event',
  'Wrong date or details',
  'Duplicate',
  'Not a summer or Somer thing',
  'Too far out of town',
  'Weak source',
  'Other',
] as const;

/** Reject an event or place; for agent finds the reason is kept so the agents can learn from it. */
export async function rejectWithReason(target: 'event' | 'place', id: string, reason: string): Promise<void> {
  const r = (REJECT_REASONS as readonly string[]).includes(reason) ? reason : 'Other';
  const table = sql.raw(target === 'event' ? 'events' : 'places');
  await query(sql`
    update ${table} set status = 'rejected', updated_at = now(),
      review_note = case when review_note like 'Found by agent%'
        then ${'Found by agent. Rejected: ' + r + '. '} || coalesce(substring(review_note from 'Source: \\S+'), '')
        else ${'Rejected: ' + r} end
    where id = ${id}`);
}
