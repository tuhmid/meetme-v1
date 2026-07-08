import { describe, it, expect } from 'vitest';
import { MAX_COMPENSATION_CENTS, MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS, computeTotalFeeCents, depositForAmount, recoveryFeeForDeposit, splitFee, usd } from './money';

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

describe('deposit (5% of the deal, floored $5, capped $25)', () => {
  it('floors at $5, scales at 5%, caps at $25', () => {
    expect(depositForAmount(50_00)).toBe(5_00);    // 5% = $2.50 -> floor $5
    expect(depositForAmount(100_00)).toBe(5_00);   // 5% = $5
    expect(depositForAmount(120_00)).toBe(6_00);
    expect(depositForAmount(350_00)).toBe(17_50);
    expect(depositForAmount(500_00)).toBe(25_00);
    expect(depositForAmount(1000_00)).toBe(25_00); // capped
    expect(MIN_DEPOSIT_CENTS).toBe(5_00);
    expect(MAX_DEPOSIT_CENTS).toBe(25_00);
  });
});

describe('fee split (buyer capped at deposit − $1, so ~50/50 as the deposit scales)', () => {
  it('splits ~50/50 when the deposit covers it, odd cent to the seller', () => {
    expect(splitFee(15_00, 17_50)).toEqual({ buyerFeeCents: 7_50, sellerFeeCents: 7_50 }); // $350 deal
    expect(splitFee(5_05, 25_00)).toEqual({ buyerFeeCents: 2_52, sellerFeeCents: 2_53 });  // odd cent -> seller
  });

  it('caps the buyer at deposit − $1 so completion always returns ≥ $1', () => {
    // a $5 deposit caps the buyer at $4 (the original small-deal behavior)
    expect(splitFee(9_00, 5_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 5_00 });
    expect(splitFee(50_00, 5_00)).toEqual({ buyerFeeCents: 4_00, sellerFeeCents: 46_00 });
    // a $1000 deal ($50 fee, $25 deposit): nearly 50/50, buyer still gets ≥$1 back
    const s = splitFee(50_00, 25_00);
    expect(s).toEqual({ buyerFeeCents: 24_00, sellerFeeCents: 26_00 });
    expect(25_00 - s.buyerFeeCents).toBeGreaterThanOrEqual(1_00);
  });
});

describe('recovery fee (20% of the forfeited deposit, comp capped at $15)', () => {
  it('is 20% of the deposit while comp stays under the cap', () => {
    expect(recoveryFeeForDeposit(5_00)).toBe(1_00);    // 20% of the $5 min = the original flat $1
    expect(recoveryFeeForDeposit(15_00)).toBe(3_00);   // $300 deal → $12 comp
    expect(recoveryFeeForDeposit(17_50)).toBe(3_50);   // $350 deal → $14 comp (still under cap)
  });

  it('caps the stood-up party at $15, MeetMe keeps the rest', () => {
    // $25 deposit (deal ≥ $500): 80% would be $20, but comp is held at $15 → MeetMe keeps $10
    expect(recoveryFeeForDeposit(25_00)).toBe(10_00);
    expect(25_00 - recoveryFeeForDeposit(25_00)).toBe(MAX_COMPENSATION_CENTS); // comp == $15
  });
});

describe('usd formatting', () => {
  it('prints whole dollars clean and cents with 2 places', () => {
    expect(usd(300_00)).toBe('$300');
    expect(usd(297_50)).toBe('$297.50');
    expect(usd(2_50)).toBe('$2.50');
  });
});
