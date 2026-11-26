import 'server-only';
import { CITIES } from '@/lib/cities';
import { query, sql } from '../db';
import { userAgent } from '../env';

/**
 * Wikivoyage's "See" and "Do" listings for each Somer town: the sights and activities travellers recommend,
 * with coordinates. Text is CC BY-SA 4.0; the place panel credits it. Refreshed every two weeks by the daily cron.
 */
export interface Listing {
  type: 'see' | 'do';
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  url: string | null;
  content: string | null;
}

/** Turn wiki markup into plain text: links keep their label, bold/italics and nested templates go. */
export function plainWiki(s: string): string {
  return s
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a template body on top-level pipes (not inside [[...]] or {{...}}). */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  return parts;
}

/** Every {{see ...}} and {{do ...}} listing with usable coordinates. */
export function parseListings(wikitext: string): Listing[] {
  const out: Listing[] = [];
  const start = /\{\{\s*(see|do)\s*(?=\|)/gi;
  let m: RegExpExecArray | null;
  while ((m = start.exec(wikitext))) {
    // Find the matching closing braces, allowing nested templates inside the listing.
    let depth = 1, i = m.index + 2;
    while (i < wikitext.length && depth > 0) {
      if (wikitext.startsWith('{{', i)) { depth++; i += 2; } else if (wikitext.startsWith('}}', i)) { depth--; i += 2; } else i++;
    }
    const body = wikitext.slice(m.index + m[0].length, i - 2);
    const params: Record<string, string> = {};
    for (const p of splitParams(body)) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    }
    const name = plainWiki(params.name ?? '');
    const lat = parseFloat(params.lat ?? ''), lng = parseFloat(params.long ?? params.lon ?? '');
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const url = /^https?:\/\//i.test(params.url ?? '') ? params.url : null;
    out.push({
      type: m[1].toLowerCase() as 'see' | 'do', name: name.slice(0, 200), lat, lng,
      address: plainWiki(params.address ?? '') || null, url: url ?? null,
      content: plainWiki(params.content ?? params.description ?? '').slice(0, 700) || null,
    });
  }
  return out;
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = new URL('https://en.wikivoyage.org/w/api.php');
  url.search = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json()) as { parse?: { wikitext?: string } };
  return json.parse?.wikitext ?? null;
}

/** The South African article for a town: "Hilton" alone may be somewhere else, so fall back to "Hilton (South Africa)". */
async function articleFor(name: string): Promise<{ title: string; text: string } | null> {
  for (const title of [name, `${name} (South Africa)`]) {
    const text = await fetchWikitext(title);
    if (text && /South Africa|KwaZulu|Cape|Gauteng|Limpopo|Mpumalanga|Free State|North West/i.test(text.slice(0, 4000))) return { title, text };
  }
  return null;
}

export async function importWikivoyage(): Promise<{ towns: number; listings: number }> {
  let towns = 0, listings = 0;
  for (const c of CITIES) {
    let article: { title: string; text: string } | null = null;
    try { article = await articleFor(c.name); } catch { continue; }
    if (!article) continue;
    towns++;
    // Keep listings near the town, so a stray coordinate can't put a pin far away.
    const near = parseListings(article.text).filter((l) => Math.hypot(l.lat - c.lat, l.lng - c.lng) < 0.8);
    for (const l of near) {
      await query(sql`
        insert into places (source, source_id, name, category_slug, lat, lng, address, city, website, description, tags, last_synced_at)
        values ('wikivoyage', ${`${article.title}#${l.name}`}, ${l.name}, ${l.type === 'see' ? 'sights' : 'activities'}, ${l.lat}, ${l.lng},
          ${l.address}, ${c.name}, ${l.url}, ${l.content}, ${JSON.stringify({ wikivoyage: article.title })}::jsonb, now())
        on conflict (source, source_id) do update set
          lat = case when 'lat' = any(places.locked_fields) then places.lat else excluded.lat end,
          lng = case when 'lng' = any(places.locked_fields) then places.lng else excluded.lng end,
          address = case when 'address' = any(places.locked_fields) then places.address else excluded.address end,
          website = case when 'website' = any(places.locked_fields) then places.website else excluded.website end,
          description = case when 'description' = any(places.locked_fields) then places.description else excluded.description end,
          last_synced_at = now(), updated_at = now()`);
      listings++;
    }
  }
  return { towns, listings };
}

/** True when the last Wikivoyage import is more than two weeks old (or never ran). */
export async function wikivoyageDue(): Promise<boolean> {
  const [row] = await query<{ last: Date | null }>(sql`select max(last_synced_at) as last from places where source = 'wikivoyage'`);
  return !row?.last || Date.now() - new Date(row.last).getTime() > 14 * 86_400_000;
}
