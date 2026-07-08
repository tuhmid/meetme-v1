// ---------------------------------------------------------------------------
// Money. Integer cents everywhere — no floats (kills the rounding/$NaN class of
// bugs the prototype had). The fee and the deposit are pure functions of the
// deal price.
// ---------------------------------------------------------------------------

export type Cents = number; // always an integer number of cents

/** Display helper: whole dollars print clean, cents print with 2 places. */
export const usd = (c: Cents): string => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

/**
 * Refundable show-up deposit — 5% of the deal, floored at $5 and capped at $25.
 * It scales with the deal so (a) the no-show stake is meaningful on bigger deals and
 * (b) it can absorb the buyer's fair (~half) fee share while always returning ≥$1 on
 * completion. Held per side: the buyer's rides in escrow with the price; the seller's
 * is a card hold. Forfeited (minus a $1 recovery fee) to the stood-up party on a no-show.
 */
export const MIN_DEPOSIT_CENTS: Cents = 5_00;
export const MAX_DEPOSIT_CENTS: Cents = 25_00;
export const DEPOSIT_RATE = 0.05; // 5% of the deal
export function depositForAmount(amountCents: Cents): Cents {
  return Math.min(MAX_DEPOSIT_CENTS, Math.max(MIN_DEPOSIT_CENTS, Math.round(amountCents * DEPOSIT_RATE)));
}

/**
 * On a no-show, the flake's deposit compensates the stood-up party — but MeetMe keeps a
 * recovery fee (a forfeited deal earns no platform fee yet still costs processing). The
 * fee is 20% of the forfeited deposit, so the stood-up party keeps 80% — UNLESS that
 * would exceed the compensation cap, in which case their comp is held at the cap and
 * MeetMe keeps the rest. The cap only bites on big deals (deposit > $18.75, i.e. deal >
 * ~$375); below it the plain 20% applies. (20% of the $5 min deposit is $1 — the original
 * flat fee.) Never applied when NEITHER party shows.
 */
export const RECOVERY_FEE_RATE = 0.20;
export const MAX_COMPENSATION_CENTS: Cents = 15_00; // the stood-up party never nets more than this off a forfeit
export function recoveryFeeForDeposit(depositCents: Cents): Cents {
  const comp = Math.min(depositCents - Math.round(depositCents * RECOVERY_FEE_RATE), MAX_COMPENSATION_CENTS);
  return depositCents - comp;
}

/**
 * TOTAL platform fee for a completed deal (both sides combined — split with
 * splitFee). Tiered flat so users never do math; 5% above $500, capped at $50.
 * Charged only on completion.
 */
export function computeTotalFeeCents(amountCents: Cents): Cents {
  if (amountCents <= 40_00) return 5_00;
  if (amountCents <= 80_00) return 7_00;
  if (amountCents <= 120_00) return 9_00;
  if (amountCents <= 200_00) return 10_00;
  if (amountCents <= 300_00) return 12_00;
  if (amountCents <= 500_00) return 15_00;
  return Math.min(Math.round(amountCents * 0.05), 50_00);
}

/**
 * Split the total fee between the sides. Each pays their fair (~half) share, but the
 * buyer's is capped at `deposit − $1` so completing a deal always returns at least $1
 * of their deposit — showing up and finishing must never cost the whole deposit. Because
 * the deposit scales with the deal, the split stays ~50/50 at any size. Odd cent → seller.
 */
export function splitFee(totalFeeCents: Cents, depositCents: Cents): { buyerFeeCents: Cents; sellerFeeCents: Cents } {
  const buyerFeeCents = Math.min(Math.floor(totalFeeCents / 2), depositCents - 1_00);
  return { buyerFeeCents, sellerFeeCents: totalFeeCents - buyerFeeCents };
}

/**
 * Minimum deal size. Below this the fee + deposit dwarf the price and the
 * escrow loop stops making sense ($5 item -> $10 out of pocket). Tunable.
 */
export const MIN_DEAL_CENTS: Cents = 5_00;

/**
 * Phone-tier deal cap: deals up to this need only a verified phone; above it, the
 * creator must be ID-verified. Kept low-friction for v1; tune to the licensed
 * money partner's max.
 */
export const PHONE_TIER_MAX_CENTS: Cents = 500_00;

/** True when a deal of this size needs ID verification the creator doesn't have. */
export const requiresKyc = (isIdVerified: boolean, amountCents: Cents): boolean =>
  amountCents > PHONE_TIER_MAX_CENTS && !isIdVerified;
