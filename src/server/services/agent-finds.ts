import 'server-only';
import { CITIES } from '@/lib/cities';
import { query, sql } from '../db';
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
