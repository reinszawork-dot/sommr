import 'server-only';
import { env, userAgent } from '../env';

/**
 * Real places from OpenStreetMap (© OpenStreetMap contributors, ODbL).
 *
 * Primary source: the Overpass API — one query per map grid cell returns every
 * category at once. If every Overpass endpoint fails, a small, rate-limited
 * Nominatim category search is used as a fallback (on by default in development;
 * set PLACES_NOMINATIM_FALLBACK=true to allow it in production — light use only,
 * per the Nominatim usage policy).
 */

export interface OsmFilter {
  key: string;
  values: string[];
}

export interface OsmElement {
  sourceId: string; // e.g. node/123
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** 'amenity=cafe' or 'leisure=park|garden' → { key, values } */
export function parseFilter(f: string): OsmFilter | null {
  const m = f.trim().match(/^([a-z_:]+)=([a-z0-9_|:;-]+)$/i);
  if (!m) return null;
  return { key: m[1], values: m[2].split('|').filter(Boolean) };
}

export function matchesFilter(tags: Record<string, string>, filter: OsmFilter): boolean {
  const v = tags[filter.key];
  return v !== undefined && filter.values.includes(v);
}

export function buildOverpassQuery(bbox: Bbox, filters: OsmFilter[], limit = 2000): string {
  const box = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  const clauses = filters.map((f) => {
    const sel =
      f.values.length === 1
        ? `["${f.key}"="${f.values[0]}"]`
        : `["${f.key}"~"^(${f.values.map((v) => v.replace(/[^a-z0-9_:-]/gi, '')).join('|')})$"]`;
    return `  nwr${sel}["name"](${box});`;
  });
  return `[out:json][timeout:30];\n(\n${clauses.join('\n')}\n);\nout center tags ${limit};`;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function parseOverpass(json: { elements?: OverpassElement[] }): OsmElement[] {
  const out: OsmElement[] = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null || !el.tags?.name) continue;
    out.push({ sourceId: `${el.type}/${el.id}`, lat, lng, tags: el.tags });
  }
  return out;
}

/** After every endpoint fails, skip Overpass for a few minutes instead of waiting on timeouts. */
let overpassDownUntil = 0;

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  if (Date.now() < overpassDownUntil) throw new Error('Overpass recently unreachable (backing off)');
  let lastError: unknown = null;
  for (const url of env.OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
        body: new URLSearchParams({ data: query }),
        // The main instance gets longer; mirrors are a quick second try.
        signal: AbortSignal.timeout(url === env.OVERPASS_URLS[0] ? 15_000 : 7_000),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Overpass ${new URL(url).host} HTTP ${res.status}`);
      return parseOverpass(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  overpassDownUntil = Date.now() + 5 * 60_000;
  throw lastError ?? new Error('No Overpass endpoint configured');
}

// ───────────────────────────── Geoapify (keyed, OSM-based) ─────────────────────────────

/** OSM tag → Geoapify category. Only keys confirmed in Geoapify's docs: an unknown key fails the whole request. */
const GEOAPIFY_CATEGORIES: Record<string, string> = {
  'natural=beach': 'beach',
  'amenity=restaurant': 'catering.restaurant',
  'amenity=cafe': 'catering.cafe',
  'amenity=bbq': 'leisure.picnic.bbq',
  'leisure=picnic_site': 'leisure.picnic.picnic_site',
  'amenity=marketplace': 'commercial.marketplace',
  'tourism=viewpoint': 'tourism.attraction.viewpoint',
  'leisure=park': 'leisure.park',
  'leisure=nature_reserve': 'leisure.park.nature_reserve',
  'leisure=garden': 'leisure.park.garden',
  'amenity=cinema': 'entertainment.cinema',
  'amenity=theatre': 'entertainment.culture.theatre',
  'amenity=arts_centre': 'entertainment.culture.arts_centre',
  'amenity=nightclub': 'adult.nightclub',
  'leisure=water_park': 'entertainment.water_park',
  'leisure=bowling_alley': 'entertainment.bowling_alley',
  'tourism=theme_park': 'entertainment.theme_park',
};

interface GeoapifyFeature {
  properties: {
    place_id: string;
    name?: string;
    lat: number;
    lon: number;
    categories?: string[];
    street?: string;
    housenumber?: string;
    suburb?: string;
    city?: string;
    website?: string;
    opening_hours?: string;
    contact?: { phone?: string };
    datasource?: { raw?: Record<string, string | number> };
  };
}

const OSM_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' };

/** Turn Geoapify features into OSM-style elements so categorise() and the address helpers work unchanged. */
export function parseGeoapify(json: { features?: GeoapifyFeature[] }, mapped: [string, string][]): OsmElement[] {
  const out: OsmElement[] = [];
  for (const { properties: p } of json.features ?? []) {
    if (!p.name) continue;
    const raw = p.datasource?.raw ?? {};
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') tags[k] = v;
    tags.name = p.name;
    // Make sure the tag we asked for is present, even if the raw OSM tags are missing.
    for (const [tag, cat] of mapped) {
      const [key, value] = tag.split('=');
      if (!tags[key] && p.categories?.includes(cat)) tags[key] = value;
    }
    if (p.street && !tags['addr:street']) tags['addr:street'] = p.street;
    if (p.housenumber && !tags['addr:housenumber']) tags['addr:housenumber'] = p.housenumber;
    if (p.suburb && !tags['addr:suburb']) tags['addr:suburb'] = p.suburb;
    if (p.city && !tags['addr:city']) tags['addr:city'] = p.city;
    if (p.website && !tags.website) tags.website = p.website;
    if (p.opening_hours && !tags.opening_hours) tags.opening_hours = p.opening_hours;
    if (p.contact?.phone && !tags.phone) tags.phone = p.contact.phone;
    // Same id as Overpass rows (e.g. node/123) so the two sources never duplicate a place.
    const osmType = OSM_TYPES[String(raw.osm_type ?? '')];
    const sourceId = osmType && raw.osm_id != null ? `${osmType}/${raw.osm_id}` : `geoapify/${p.place_id}`;
    out.push({ sourceId, lat: p.lat, lng: p.lon, tags });
  }
  return out;
}

async function fetchGeoapify(bbox: Bbox, filters: OsmFilter[]): Promise<OsmElement[]> {
  const mapped = filters
    .flatMap((f) => f.values.map((v) => `${f.key}=${v}`))
    .filter((t) => GEOAPIFY_CATEGORIES[t])
    .map((t): [string, string] => [t, GEOAPIFY_CATEGORIES[t]]);
  if (mapped.length === 0) return [];
  const url = new URL('https://api.geoapify.com/v2/places');
  url.searchParams.set('categories', [...new Set(mapped.map(([, c]) => c))].join(','));
  url.searchParams.set('filter', `rect:${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  url.searchParams.set('limit', '500');
  url.searchParams.set('apiKey', env.GEOAPIFY_API_KEY!);
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Geoapify HTTP ${res.status}`);
  return parseGeoapify(await res.json(), mapped);
}

// ───────────────────────────── Nominatim fallback ─────────────────────────────

let nominatimQueue: Promise<unknown> = Promise.resolve();
/** Serialise Nominatim calls to at most one per second (usage policy). */
export function nominatimFetch(url: URL): Promise<Response> {
  const run = nominatimQueue.then(async () => {
    if (env.NOMINATIM_EMAIL) url.searchParams.set('email', env.NOMINATIM_EMAIL);
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent(), Referer: env.APP_URL, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    await new Promise((r) => setTimeout(r, 1100));
    return res;
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

interface NominatimResult {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  extratags?: Record<string, string> | null;
  address?: Record<string, string>;
}

export function nominatimFallbackEnabled(): boolean {
  const v = process.env.PLACES_NOMINATIM_FALLBACK;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return !env.isProduction;
}

async function fetchNominatim(bbox: Bbox, filters: OsmFilter[]): Promise<OsmElement[]> {
  const out = new Map<string, OsmElement>();
  for (const f of filters) {
    for (const value of f.values) {
      const url = new URL('/search', env.NOMINATIM_URL);
      url.searchParams.set('q', `[${f.key}=${value}]`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('viewbox', `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`);
      url.searchParams.set('bounded', '1');
      url.searchParams.set('limit', '40');
      url.searchParams.set('extratags', '1');
      url.searchParams.set('addressdetails', '1');
      const res = await nominatimFetch(url);
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const rows = (await res.json()) as NominatimResult[];
      for (const r of rows) {
        if (!r.name) continue;
        const a = r.address ?? {};
        const tags: Record<string, string> = { ...(r.extratags ?? {}), name: r.name, [f.key]: value };
        if (a.road) tags['addr:street'] = a.road;
        if (a.house_number) tags['addr:housenumber'] = a.house_number;
        const area = [a.neighbourhood, a.quarter, a.suburb, a.city_district].find((v) => v && !WARD.test(v));
        if (area) tags['addr:suburb'] = area;
        if (a.city || a.town || a.village) tags['addr:city'] = a.city ?? a.town ?? a.village;
        out.set(`${r.osm_type}/${r.osm_id}`, {
          sourceId: `${r.osm_type}/${r.osm_id}`,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          tags,
        });
      }
    }
  }
  return [...out.values()];
}

/**
 * Fetch named places inside a bounding box: all `filters` from Overpass, or — if
 * Overpass is unreachable and the fallback is allowed — just `fallbackFilters`
 * from Nominatim (it needs one request per tag, so we ask for less).
 */
export async function fetchOsmPlaces(
  bbox: Bbox,
  filters: OsmFilter[],
  fallbackFilters: OsmFilter[] = filters,
): Promise<{ elements: OsmElement[]; via: 'geoapify' | 'overpass' | 'nominatim' }> {
  if (env.GEOAPIFY_API_KEY) {
    try {
      return { elements: await fetchGeoapify(bbox, filters), via: 'geoapify' };
    } catch (err) {
      console.warn('[places] Geoapify failed, trying Overpass:', (err as Error).message);
    }
  }
  try {
    return { elements: await fetchOverpass(buildOverpassQuery(bbox, filters)), via: 'overpass' };
  } catch (err) {
    if (!nominatimFallbackEnabled()) throw err;
    console.warn('[places] Overpass unavailable, using Nominatim fallback:', (err as Error).message);
    return { elements: await fetchNominatim(bbox, fallbackFilters), via: 'nominatim' };
  }
}

/** Municipal ward names ("Cape Town Ward 115") aren't meaningful to people. */
const WARD = /\bward\s*\d+/i;

/** Human-friendly address from OSM tags. */
export function addressFromTags(tags: Record<string, string>): { address: string | null; suburb: string | null; city: string | null } {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const rawSuburb = tags['addr:suburb'] ?? null;
  const suburb = rawSuburb && !WARD.test(rawSuburb) ? rawSuburb : null;
  const city = tags['addr:city'] ?? null;
  const parts = [street || tags['addr:place'], suburb, city].filter(Boolean);
  return { address: parts.length ? parts.join(', ') : null, suburb, city };
}

/** Keep the useful OSM tags only (the rest stays in OpenStreetMap). */
export function pickTags(tags: Record<string, string>): Record<string, string> {
  const keep = [
    'amenity', 'leisure', 'natural', 'tourism', 'shop', 'waterway', 'cuisine', 'outdoor_seating', 'wheelchair',
    'fee', 'access', 'diet:vegetarian', 'diet:vegan', 'takeaway', 'internet_access', 'description', 'wikipedia',
    'wikidata', 'operator', 'surface', 'supervised', 'lifeguard', 'dog', 'blue_flag',
  ];
  const out: Record<string, string> = {};
  for (const k of keep) if (tags[k]) out[k] = tags[k];
  return out;
}

export function websiteFromTags(tags: Record<string, string>): string | null {
  const w = tags.website ?? tags['contact:website'] ?? tags.url ?? null;
  if (!w) return null;
  const url = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
