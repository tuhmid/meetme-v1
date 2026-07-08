# Deal rules — the full lifecycle (what happens to the money)

The authoritative rules, enforced server-side in `@meetme/core`. Money is in integer
cents; every ledger transaction sums to zero (nothing created/destroyed).

## Money pieces
- **Price** — the item cost (buyer → escrow → seller on completion).
- **Fee** — ONE total per deal, tiered by price, **charged only on completion**:

  | Price | Total fee |
  |---|---|
  | ≤ $40 | $5 |
  | ≤ $80 | $7 |
  | ≤ $120 | $9 |
  | ≤ $200 | $10 |
  | ≤ $300 | $12 |
  | ≤ $500 | $15 |
  | > $500 | 5% of price, capped at $50 |

  The total is **split between the sides**: the buyer pays half, **capped at
  deposit − $1** (odd cent to the seller); the seller pays the rest. The cap
  guarantees a buyer who completes a deal always gets **at least $1 of their
  deposit back** — finishing must never cost the whole deposit. Because the
  deposit scales with the deal (below), the split stays ~50/50 at any size.
- **Deposit** — a refundable show-up stake, **5% of the deal, floored at $5 and
  capped at $25** (per side). It scales so the no-show stake stays meaningful on
  bigger deals and can absorb the buyer's fair (~half) fee share while still
  returning ≥ $1 on completion. Held asymmetrically by design:
  - **Buyer**: escrowed with the funding (buyer upfront = **price + deposit**, nothing else).
  - **Seller**: never escrowed. The seller keeps a **card on file** ($0 validation,
    required to accept terms); a **deposit-sized authorization hold** is placed when
    they head out and **captured only if they no-show / back out** after that.
  - On a forfeit the deposit goes to the stood-up party **minus a recovery fee**
    (below) — the party who showed up always keeps the large majority.
- **Recovery fee** — a forfeited deal earns no platform fee yet still costs
  processing and support, so MeetMe keeps **20% of the forfeited deposit** on a
  no-show / back-out; the stood-up party keeps the other **80%** — but their
  compensation is **capped at $15**, and MeetMe keeps anything above that. The cap
  only bites on big deals (deposit > $18.75, i.e. deal > ~$375); at the max ($25
  deposit) the stood-up party nets **$15** and MeetMe keeps **$10**. Never charged
  when *neither* party shows — a mutual flake is a full no-fault refund.
- **Minimum deal: $5** — below that the fee + deposit dwarf the item and the loop stops making sense. (No max yet; the phone tier caps at $500 without ID verification. A licensed partner will impose a hard cap later.)

**Worked example — $150 deal.** Deposit is 5% = **$7.50**; the buyer funds
**$157.50** (price + deposit). Total fee $10 → buyer $5 / seller $5. On
completion: seller is paid **$145** ($150 − $5), the buyer gets **$2.50** of the
deposit back ($7.50 − $5), platform keeps **$10**. If the seller no-shows
instead: the buyer is fully refunded and gets **$6** of the seller's $7.50
deposit (80%); MeetMe keeps the **$1.50** recovery fee (20%). Every transaction
sums to zero.

## Happy path
DRAFT → AGREED (seller accepts — card on file required) → ARMED (buyer funds
price + deposit; **the FUND arms the deal directly — there is no seller stake
turn**) → EN_ROUTE (head out; the seller's head-out places their deposit card hold) →
AT_MEETUP (both arrive / geofence) → CONFIRMING (release code entered) →
**RELEASED**. Seller gets price − their fee share and their card hold is released
untouched; buyer gets deposit − their fee share back (≥ $1); platform keeps the
total fee.

## Backing out / cancelling  ← (reviewed & fixed)
The line is **"heading out."**
- **Before anyone heads out** (DRAFT/AGREED/ARMED): back out any time, **free** —
  the buyer is refunded in full (price + deposit); the seller was never
  charged anything to begin with. No penalty, no fees.
- **After you've headed out** (EN_ROUTE): backing out is a **self-declared no-show** —
  you **forfeit your deposit to the other party**, who is made whole (they keep
  80%; MeetMe keeps a 20% recovery fee):
  - Buyer backs out: the price returns to the buyer; their escrowed deposit
    pays the stood-up **seller** (minus the recovery fee); any seller card hold is released.
  - Seller backs out: the buyer's escrow (price + deposit) is refunded in full AND the
    seller's card hold is captured and routed to the **buyer** (minus the recovery fee).
  **The only fee on a no-show is the 20% recovery fee** the company keeps; the
  stood-up party keeps the other 80%. Small trust hit either way.
- **At the meetup** (AT_MEETUP): you can't just cancel — if something's wrong it's a
  **dispute**.

## No-show (automatic, via the worker)
EN_ROUTE with one party present and the other absent past the window → the absent
party forfeits their deposit **to the stood-up party** (who keeps 80%; MeetMe keeps
the 20% recovery fee); the present party is fully refunded. Same economics as a
self-declared back-out (a stood-up buyer on a $150 deal gets their $157.50 escrow
back plus **$6** of the seller's captured $7.50 deposit — completely whole; the
platform keeps the $1.50 recovery fee). If the seller never even headed out (so no
hold exists), their card on file is charged directly.
**If collection fails** (empty/prepaid card, chargeback): the company absorbs the
payout to the wronged party and the seller takes a massive trust hit.

## Disputes
Open from ARMED/EN_ROUTE/AT_MEETUP/CONFIRMING → `DISPUTED` (funds frozen). Both submit
statements. Resolution:
- **Self-service:** both propose the same outcome (release / refund / split) → it
  **auto-resolves by agreement**, no fault, no trust hit.
- **Support/admin:** if they can't agree, a specialist decides (release/refund/split).
  release → completion money (seller gets price − their fee share, buyer gets
  deposit − their fee share, platform keeps the fee; buyer at fault) · refund →
  buyer gets price + deposit back in full, no fees (seller at fault) · split →
  price 50/50 **and both deposits returned in full, no fees** — a split is a
  no-fault outcome, so nobody's deposit is touched and the company charges
  nothing. At-fault party takes a trust hit.
- Dispute endings never capture the seller's deposit — any card hold is released.

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
