// Pure geo helpers for co-location detection. No I/O — the server feeds in the
// two parties' latest coordinates and asks "are they together yet?".

export interface LatLng {
  lat: number;
  lng: number;
}

/** Default radius (meters) within which two phones count as "at the same spot". */
export const COLOCATION_RADIUS_M = 60;

const R_EARTH_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in meters (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the two points are within `radiusM` meters of each other. */
export function withinRadius(a: LatLng, b: LatLng, radiusM: number = COLOCATION_RADIUS_M): boolean {
  return haversineMeters(a, b) <= radiusM;
}

/** Geographic midpoint of two nearby points (average is exact enough within a city). */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
