// ---------------------------------------------------------------------------
// Money. Integer cents everywhere — no floats (kills the rounding/$NaN class of
// bugs the prototype had). Fees and the commitment are pure functions of the
// deal price.
// ---------------------------------------------------------------------------

export type Cents = number; // always an integer number of cents

/** Display helper: whole dollars print clean, cents print with 2 places. */
export const usd = (c: Cents): string => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

/**
 * Platform fee PER SIDE, by deal price (tiered flat — users never do math).
 * Each party pays this; charged only on completion.
 */
export function computeFeeCents(amountCents: Cents): Cents {
  if (amountCents <= 200_00) return 2_50;
  if (amountCents <= 500_00) return 4_00;
  if (amountCents <= 1000_00) return 5_00;
  return 10_00;
}

/** Refundable commitment PER SIDE; forfeited to the company on a no-show. */
export function computeCommitmentCents(amountCents: Cents): Cents {
  return amountCents <= 50_00 ? 2_50 : 5_00;
}

/**
 * Minimum deal size. Below this the flat fee + commitment dwarf the price and the
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
