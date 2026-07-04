export interface MapPoint {
  lat: number;
  lng: number;
  color: string; // hex WITHOUT '#', e.g. '2f6f5e'
}

/**
 * Build a Geoapify Static Maps URL (OpenStreetMap data) with a marker per point,
 * fit to a padded bounding box around them. Returns null if there are no points.
 * The API key is embedded here on the SERVER only — the client just gets the image URL.
 */
export function geoapifyMapUrl(points: MapPoint[], apiKey: string, size: { w: number; h: number } = { w: 640, h: 340 }): string | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const pad = 0.0025; // ~250m of breathing room so co-located points don't over-zoom
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;
  const markers = points
    .map((p) => `lonlat:${p.lng},${p.lat};type:material;color:%23${p.color};size:medium`)
    .join('%7C'); // %7C == '|', Geoapify's marker separator
  const params = [
    'style=osm-bright',
    `width=${size.w}`,
    `height=${size.h}`,
    `area=rect:${minLng},${minLat},${maxLng},${maxLat}`,
    `marker=${markers}`,
    `apiKey=${apiKey}`,
  ];
  return `https://maps.geoapify.com/v1/staticmap?${params.join('&')}`;
}
