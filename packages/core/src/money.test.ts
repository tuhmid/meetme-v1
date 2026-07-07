import { describe, it, expect } from 'vitest';
import { DEPOSIT_CENTS, computeTotalFeeCents, splitFee, usd } from './money';

describe('total fee tiers (whole deal, cents)', () => {
  it('matches the agreed schedule at the boundaries', () => {
    expect(computeTotalFeeCents(5_00)).toBe(5_00);
    expect(computeTotalFeeCents(40_00)).toBe(5_00);
    expect(computeTotalFeeCents(40_01)).toBe(7_00);
    expect(computeTotalFeeCents(80_00)).toBe(7_00);
    expect(computeTotalFeeCents(80_01)).toBe(9_00);
    expect(computeTotalFeeCents(120_00)).toBe(9_00);
    expect(computeTotalFeeCents(120_01)).toBe(10_00);
    expect(computeTotalFeeCents(200_00)).toBe(10_00);
    expect(computeTotalFeeCents(200_01)).toBe(12_00);
    expect(computeTotalFeeCents(300_00)).toBe(12_00);
    expect(computeTotalFeeCents(300_01)).toBe(15_00);
    expect(computeTotalFeeCents(500_00)).toBe(15_00);
  });

  it('is 5% above $500, capped at $50', () => {
    expect(computeTotalFeeCents(500_01)).toBe(25_00); // round(50001 * 0.05) = 2500
    expect(computeTotalFeeCents(600_00)).toBe(30_00);
    expect(computeTotalFeeCents(1000_00)).toBe(50_00); // exactly at the cap
    expect(computeTotalFeeCents(2000_00)).toBe(50_00); // capped
  });
});

describe('fee split (buyer capped at $4)', () => {
  it('splits 50/50 below the cap, odd cent to the seller', () => {
    expect(splitFee(5_00)).toEqual({ buyerFeeCents: 2_50, sellerFeeCents: 2_50 });
    expect(splitFee(7_00)).toEqual({ buyerFeeCents: 3_50, sellerFeeCents: 3_50 });
    expect(splitFee(5_05)).toEqual({ buyerFeeCents: 2_52, sellerFeeCents: 2_53 });
  });

  it('caps the buyer at $4 so completion always returns ≥ $1 of the deposit', () => {
    expect(splitFee(9_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 5_00 });
    expect(splitFee(10_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 6_00 });
    expect(splitFee(12_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 8_00 });
    expect(splitFee(50_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 46_00 });
    expect(DEPOSIT_CENTS - splitFee(50_00).buyerFeeCents).toBeGreaterThanOrEqual(1_00);
  });
});

describe('deposit', () => {
  it('is a flat $5 per side at every deal size', () => {
    expect(DEPOSIT_CENTS).toBe(5_00);
  });
});

describe('usd formatting', () => {
  it('prints whole dollars clean and cents with 2 places', () => {
    expect(usd(300_00)).toBe('$300');
    expect(usd(297_50)).toBe('$297.50');
    expect(usd(2_50)).toBe('$2.50');
  });
});
