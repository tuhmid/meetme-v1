// ---------------------------------------------------------------------------
// Money. Integer cents everywhere — no floats (kills the rounding/$NaN class of
// bugs the prototype had). The fee and the deposit are pure functions of the
// deal price.
// ---------------------------------------------------------------------------

export type Cents = number; // always an integer number of cents

/** Display helper: whole dollars print clean, cents print with 2 places. */
export const usd = (c: Cents): string => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

/**
 * Flat, refundable show-up deposit — $5 per side, every deal size.
 * The buyer's rides along in escrow with the price; the seller's is a card hold
 * placed at head-out. Forfeited to the stood-up party on a no-show, never to us.
 */
export const DEPOSIT_CENTS: Cents = 5_00;

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
 * Split the total fee between the sides. The buyer's share is capped at $4 so
 * completing a deal always returns at least $1 of their $5 deposit — showing up
 * and finishing must never cost the whole deposit. Odd cent goes to the seller.
 */
export function splitFee(totalFeeCents: Cents): { buyerFeeCents: Cents; sellerFeeCents: Cents } {
  const buyerFeeCents = Math.min(Math.floor(totalFeeCents / 2), 4_00);
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
