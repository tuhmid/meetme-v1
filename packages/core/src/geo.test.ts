import { describe, it, expect } from 'vitest';
import { COLOCATION_RADIUS_M, haversineMeters, midpoint, withinRadius } from './geo';

describe('geo: haversine distance + co-location', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters({ lat: 40.7128, lng: -74.006 }, { lat: 40.7128, lng: -74.006 })).toBeCloseTo(0, 3);
  });

  it('flags nearby points as co-located and distant ones as not', () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const near = { lat: 40.71283, lng: -74.00605 }; // a few meters away
    const far = { lat: 40.72, lng: -74.01 }; // hundreds of meters away
    expect(withinRadius(a, near, COLOCATION_RADIUS_M)).toBe(true);
    expect(withinRadius(a, far, COLOCATION_RADIUS_M)).toBe(false);
  });

  it('matches a known long distance (NYC → LA ≈ 3936 km)', () => {
    const km = haversineMeters({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 }) / 1000;
    expect(km).toBeGreaterThan(3900);
    expect(km).toBeLessThan(3970);
  });

  it('midpoint is halfway between two points', () => {
    const m = midpoint({ lat: 40.70, lng: -74.02 }, { lat: 40.72, lng: -74.00 });
    expect(m.lat).toBeCloseTo(40.71, 5);
    expect(m.lng).toBeCloseTo(-74.01, 5);
  });
});
