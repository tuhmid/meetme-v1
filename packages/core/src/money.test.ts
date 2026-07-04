import { describe, it, expect } from 'vitest';
import { computeFeeCents, computeCommitmentCents, usd } from './money';

describe('fee tiers (per side, cents)', () => {
  it('matches the agreed schedule at the boundaries', () => {
    expect(computeFeeCents(50_00)).toBe(2_50);
    expect(computeFeeCents(200_00)).toBe(2_50);
    expect(computeFeeCents(200_01)).toBe(4_00);
    expect(computeFeeCents(500_00)).toBe(4_00);
    expect(computeFeeCents(500_01)).toBe(5_00);
    expect(computeFeeCents(1000_00)).toBe(5_00);
    expect(computeFeeCents(1000_01)).toBe(10_00);
  });
});

describe('commitment tier', () => {
  it('is $2.50 for small deals, $5 otherwise', () => {
    expect(computeCommitmentCents(50_00)).toBe(2_50);
    expect(computeCommitmentCents(50_01)).toBe(5_00);
    expect(computeCommitmentCents(300_00)).toBe(5_00);
  });
});

describe('usd formatting', () => {
  it('prints whole dollars clean and cents with 2 places', () => {
    expect(usd(300_00)).toBe('$300');
    expect(usd(297_50)).toBe('$297.50');
    expect(usd(2_50)).toBe('$2.50');
  });
});
