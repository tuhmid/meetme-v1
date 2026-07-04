import { describe, it, expect } from 'vitest';
import { geoapifyMapUrl } from './staticMap';

describe('geoapify static map url', () => {
  it('returns null with no points', () => {
    expect(geoapifyMapUrl([], 'k')).toBeNull();
  });

  it('builds a url with markers, a fitted area, and the key', () => {
    const url = geoapifyMapUrl(
      [
        { lat: 40.71, lng: -74.0, color: '2f6f5e' },
        { lat: 40.72, lng: -74.01, color: '3b6fe0' },
      ],
      'KEY123'
    )!;
    expect(url).toContain('maps.geoapify.com/v1/staticmap');
    expect(url).toContain('apiKey=KEY123');
    expect(url).toContain('lonlat:-74,40.71');
    expect(url).toContain('lonlat:-74.01,40.72');
    expect(url).toContain('area=rect:');
    expect(url).toContain('%232f6f5e'); // url-encoded color
  });
});
