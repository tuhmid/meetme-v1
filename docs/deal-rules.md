# Deal rules — the full lifecycle (what happens to the money)

The authoritative rules, enforced server-side in `@meetme/core`. Money is in integer
cents; every ledger transaction sums to zero (nothing created/destroyed).

## Money pieces
- **Price** — the item cost (buyer → escrow → seller on completion).
- **Fee** — flat per side, tiered by price (≤$200 $2.50 · ≤$500 $4 · ≤$1000 $5 · >$1000 $10). Charged **only on completion**.
- **Commitment** — refundable **$5/side** ($2.50 for deals ≤$50). Skin-in-the-game to guarantee you show up. Refunded on completion; **forfeited to the company** if you flake.
- **Minimum deal: $5** — below that the flat fee + commitment dwarf the item and the loop stops making sense. (No max yet; the phone tier caps at $500 without ID verification. A licensed partner will impose a hard cap later.)

## Happy path
DRAFT → AGREED (seller accepts) → FUNDED (buyer funds price+fee+commitment) → ARMED
(seller posts commitment) → EN_ROUTE (head out) → AT_MEETUP (both arrive / geofence)
→ CONFIRMING (release code entered) → **RELEASED**. Seller gets price − fee +
commitment back; buyer gets commitment back; platform keeps both fees.

## Backing out / cancelling  ← (reviewed & fixed)
The line is **"heading out."**
- **Before anyone heads out** (DRAFT/AGREED/FUNDED/ARMED): back out any time, **free** —
  everyone refunded in full (price, fee, commitments all returned). No penalty.
- **After you've headed out** (EN_ROUTE): backing out is a **self-declared no-show** —
  you **forfeit your commitment** to the company; the other side is made whole
  (price + fee back to the buyer, commitment back to whoever stayed). Small trust hit.
- **At the meetup** (AT_MEETUP): you can't just cancel — if something's wrong it's a
  **dispute**.

## No-show (automatic, via the worker)
EN_ROUTE with one party present and the other absent past the window → the absent
party forfeits their commitment (to the company); the present party is fully
refunded. Same economics as a self-declared back-out.

## Disputes
Open from ARMED/EN_ROUTE/AT_MEETUP/CONFIRMING → `DISPUTED` (funds frozen). Both submit
statements. Resolution:
- **Self-service:** both propose the same outcome (release / refund / split) → it
  **auto-resolves by agreement**, no fault, no trust hit.
- **Support/admin:** if they can't agree, a specialist decides (release/refund/split).
  release → to seller (buyer at fault) · refund → to buyer (seller at fault) · split →
  50/50. At-fault party takes a trust hit.

## Invites
Invite by phone (as buyer or seller). The invitee sees it in-app, and can **Accept**
(creates the deal) or **Decline** (dismisses it). The inviter can rescind too.

## KYC / limits
Deals up to **$500** need only a verified phone. Above $500, the **creator must be
ID-verified** (`kyc_required`) — a one-time verification bumps the tier. (Threshold is
tunable to the licensed money partner's max; the verify step is mocked until a real
KYC partner is wired.)

## Safety
- **Report** a counterparty (scam / no-show / harassment / prohibited item) from the
  deal screen. Reports are confidential and stored for the safety team to review.
- **Block** a counterparty — mutual and permanent. Once blocked, neither party can
  start a new deal or invite the other (enforced server-side on both `createDeal` and
  invites). An in-flight deal isn't force-cancelled by a block; use back-out / leave-safely
  for that.
- **Leave safely** (panic) — on an active meetup (ARMED→CONFIRMING) there's a discreet
  "Feel unsafe?" affordance: **Call 911**, or **Leave & report** which files a safety
  report, cancels the deal, and returns you home in one tap. (Cancelling mid-meetup
  follows the normal back-out money rules above.)

## Identity / trust
One account per phone (real Supabase-Auth). A **trust score** (0–100) accrues from
ratings after completed deals; no-shows / at-fault dispute outcomes ding it.

## Proposed (pending decision): frictionless seller commitment
Drop the seller's upfront $5 stake (removes the POST_STAKE turn — FUND arms the
deal directly). Instead the seller keeps a card on file ($0 validation at accept),
a **$5 authorization hold** is placed when someone heads out, and it's **captured
only on a no-show** — routed to the person who got stood up, not the company.
Buyer protection is unchanged (refunds always come from escrow); the stake was
deterrence, not compensation capital. Risk to manage: post-hoc collection can fail
(prepaid/empty cards, chargebacks) — hence the hold rather than a naked charge,
plus trust-nuke + ban on collection failure. Stripe (SetupIntent + manual-capture
PaymentIntent) is the natural rail; Trustap would replace this mechanic entirely.

> Note: everything money-related runs on **FakeRail (test-mode)** until a licensed
> partner + fintech-attorney sign-off. See `docs/PLACEHOLDERS.md`.
