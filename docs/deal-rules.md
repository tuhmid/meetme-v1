# Deal rules — the full lifecycle (what happens to the money)

The authoritative rules, enforced server-side in `@meetme/core`. Money is in integer
cents; every ledger transaction sums to zero (nothing created/destroyed).

## Money pieces
- **Price** — the item cost (buyer → escrow → seller on completion).
- **Fee** — flat per side, tiered by price (≤$200 $2.50 · ≤$500 $4 · ≤$1000 $5 · >$1000 $10). Charged **only on completion**.
- **Commitment** — **$5** ($2.50 for deals ≤$50), skin-in-the-game to guarantee you
  show up, and it's asymmetric by design:
  - **Buyer**: escrowed with the funding (refundable; returned on completion).
  - **Seller**: never escrowed. The seller keeps a **card on file** ($0 validation,
    required to accept terms); an **authorization hold** for the commitment is placed
    when they head out and **captured only if they no-show / back out** after that.
  - Either way a forfeited commitment is **routed to the stood-up party**, not the company.
- **Minimum deal: $5** — below that the flat fee + commitment dwarf the item and the loop stops making sense. (No max yet; the phone tier caps at $500 without ID verification. A licensed partner will impose a hard cap later.)

## Happy path
DRAFT → AGREED (seller accepts — card on file required) → ARMED (buyer funds
price+fee+commitment; **the FUND arms the deal directly — there is no seller stake
turn**) → EN_ROUTE (head out; the seller's head-out places their card hold) →
AT_MEETUP (both arrive / geofence) → CONFIRMING (release code entered) →
**RELEASED**. Seller gets price − fee and their card hold is released untouched;
buyer gets their commitment back; platform keeps both fees.

## Backing out / cancelling  ← (reviewed & fixed)
The line is **"heading out."**
- **Before anyone heads out** (DRAFT/AGREED/ARMED): back out any time, **free** —
  the buyer is refunded in full (price, fee, commitment); the seller was never
  charged anything to begin with. No penalty.
- **After you've headed out** (EN_ROUTE): backing out is a **self-declared no-show** —
  you **forfeit your commitment to the other party**, who is made whole:
  - Buyer backs out: price + fee return to the buyer; their escrowed commitment
    pays the stood-up **seller**; any seller card hold is released.
  - Seller backs out: the buyer's escrow is refunded in full AND the seller's card
    hold is captured and routed to the **buyer**.
  Small trust hit either way.
- **At the meetup** (AT_MEETUP): you can't just cancel — if something's wrong it's a
  **dispute**.

## No-show (automatic, via the worker)
EN_ROUTE with one party present and the other absent past the window → the absent
party forfeits their commitment **to the stood-up party**; the present party is
fully refunded. Same economics as a self-declared back-out. If the seller never
even headed out (so no hold exists), their card on file is charged directly.
**If collection fails** (empty/prepaid card, chargeback): the company absorbs the
payout to the wronged party and the seller takes a massive trust hit.

## Disputes
Open from ARMED/EN_ROUTE/AT_MEETUP/CONFIRMING → `DISPUTED` (funds frozen). Both submit
statements. Resolution:
- **Self-service:** both propose the same outcome (release / refund / split) → it
  **auto-resolves by agreement**, no fault, no trust hit.
- **Support/admin:** if they can't agree, a specialist decides (release/refund/split).
  release → to seller (buyer at fault) · refund → to buyer (seller at fault) · split →
  50/50. At-fault party takes a trust hit.
- Dispute endings never capture the seller's commitment — any card hold is released.

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

> Note: everything money-related runs on **FakeRail (test-mode)** until a licensed
> partner + fintech-attorney sign-off. The card on file / hold / capture mechanic is
> a FakeRail stub too (real rail: Stripe SetupIntent + manual-capture PaymentIntent).
> See `docs/PLACEHOLDERS.md`.
