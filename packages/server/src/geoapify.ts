// Geoapify calls for meetup-spot finding (server-only; the key never leaves here).
// Free OpenStreetMap-based tier: Places (nearby POIs), Geocoding (address → point),
// and Route Matrix (drive times, for a fair-by-time midpoint).

export interface SafeSpot {
  name: string;
  lat: number;
  lng: number;
  category: string;
  tier: 'verified' | 'public'; // police = "verified safe-exchange" tier; else public/monitored
}

// police first (official safe-exchange zones are usually here), then public monitored places
const CATEGORIES = 'service.police,public_transport,commercial.shopping_mall,service.financial.bank,commercial.supermarket';

/** Nearby safe-ish public spots around a point. */
export async function findSafeSpots(lat: number, lng: number, key: string, radiusM = 9000): Promise<SafeSpot[]> {
  const url = `https://api.geoapify.com/v2/places?categories=${CATEGORIES}&filter=circle:${lng},${lat},${radiusM}&bias=proximity:${lng},${lat}&limit=25&apiKey=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    const out: SafeSpot[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties ?? {};
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const cats: string[] = p.categories ?? [];
      const isPolice = cats.some((c) => c.startsWith('service.police'));
      const label = isPolice ? 'Police station' : cats.some((c) => c.startsWith('public_transport')) ? 'Transit hub' : cats.some((c) => c.includes('bank')) ? 'Bank' : cats.some((c) => c.includes('mall')) ? 'Shopping center' : 'Public spot';
      out.push({
        name: p.name ? `${p.name}` : `${label}${p.street ? ' · ' + p.street : ''}`,
        lat: p.lat,
        lng: p.lon,
        category: label,
        tier: isPolice ? 'verified' : 'public',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Geocode a typed address/place to a point. */
export async function geocode(text: string, key: string): Promise<{ name: string; lat: number; lng: number } | null> {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&apiKey=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const f = (data.features ?? [])[0];
    if (!f || typeof f.properties?.lat !== 'number') return null;
    return { name: f.properties.formatted ?? text, lat: f.properties.lat, lng: f.properties.lon };
  } catch {
    return null;
  }
}

/** Drive time in MINUTES from each source to each target (Route Matrix). rows[srcIdx][tgtIdx]. */
export async function driveTimeMatrix(sources: { lat: number; lng: number }[], targets: { lat: number; lng: number }[], key: string): Promise<number[][] | null> {
  const body = {
    mode: 'drive',
    sources: sources.map((s) => ({ location: [s.lng, s.lat] })),
    targets: targets.map((t) => ({ location: [t.lng, t.lat] })),
  };
  try {
    const res = await fetch(`https://api.geoapify.com/v1/routematrix?apiKey=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const st = data.sources_to_targets;
    if (!Array.isArray(st)) return null;
    return st.map((row: any[]) => row.map((c) => (c && typeof c.time === 'number' ? c.time / 60 : Infinity)));
  } catch {
    return null;
  }
}
