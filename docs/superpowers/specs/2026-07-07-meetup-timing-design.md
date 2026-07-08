# Meetup timing + mutual arrangement + recovery fee — design

Date: 2026-07-07
Status: approved (brainstorm) → implementing

## Problem

MeetMe's no-show forfeit compensates a stood-up party from the flake's $5 deposit.
The old rule armed the forfeit off **arrival alone**, so one party could manufacture
the other's forfeit by showing up and running the clock down — even when the other
never agreed to meet at that moment. There is also no agreed **meetup time**, so "when
to head out" is ad hoc.

## Goals

1. A single mutual **"Arrange the meetup"** step that pins down **where + when**, so a
   forfeit can only ever run against a time/commitment both sides accepted.
2. Support both **ASAP** (coordinate live) and **Scheduled** (agree a time) — both
   first-class.
3. Keep the forfeit compensating the stood-up party, but take a **$1 recovery fee** so
   the platform isn't underwater on failed deals.
4. Close the "neither party showed" stranding gap (audit #15) for arranged deals.

## Non-goals

- Calendar integration / timezones beyond the device's local time.
- Rescheduling after someone has headed out (reschedule is allowed only up to ARMED).
- Re-authorizing a card hold for deals scheduled beyond the ~7-day auth window (deferred;
  scheduled deals are expected within days).

## Design

### 1. Mutual "Arrange the meetup" (propose → confirm)

Replaces today's unilateral `SET_MEETUP`. Mirrors the dispute `PROPOSE_RESOLUTION` shape.

- **`PROPOSE_MEETUP { actor, name, lat, lng, custom, time }`** — `time: number | null`
  (epoch ms; `null` = ASAP). Records a *proposed* meetup: sets `meetupName/lat/lng/custom`,
  `meetupTime`, `meetupProposedBy = actor`, `meetupConfirmed = false`.
- **`CONFIRM_MEETUP { actor }`** — the OTHER party (`actor !== meetupProposedBy`) confirms.
  Sets `meetupConfirmed = true`. For a **scheduled** deal this also emits
  `hold_seller_commitment` (the seller's $5 card hold), so the deposit exists by time T.
- **Reschedule** = another `PROPOSE_MEETUP` (resets `meetupConfirmed = false`,
  new `meetupProposedBy`); the other re-confirms. An already-placed seller hold stays.
- Allowed states: `DRAFT, AGREED, FUNDED, ARMED`.
- **`HEAD_OUT` now requires `meetupConfirmed`** (both agreed on where + when), not just a
  spot name.

New `Deal` fields:

| field | type | meaning |
|---|---|---|
| `meetupTime` | `number \| null` | epoch ms; `null` = ASAP |
| `meetupProposedBy` | `Role \| null` | who proposed the current meetup |
| `meetupConfirmed` | `boolean` | both agreed |

(existing `meetupName/meetupLat/meetupLng/meetupCustom` unchanged)

### 2. Two clocks, one forfeit engine

The confirmed meetup carries a mode; only the *clock source* differs:

| | ASAP (`meetupTime == null`) | Scheduled (`meetupTime = T`) |
|---|---|---|
| Commitment | both tapped `HEAD_OUT` | both `CONFIRM_MEETUP`'d T |
| No-show deadline | 2nd head-out + `noShowMs` (30 min) | **T + `graceMs` (20 min)** |
| Seller $5 hold | placed at `HEAD_OUT` | placed at `CONFIRM_MEETUP` |
| Evaluated from state | EN_ROUTE | ARMED **or** EN_ROUTE |

Everything after the deadline (present-party-wins, geofence arrival) is identical.

### 3. Forfeit outcome + recovery fee

`EXPIRE_NO_SHOW { noShow: 'buyer' | 'seller' | 'both' }` (union extended with `'both'`):

- **one showed, one didn't** (`'buyer'`/`'seller'`): capture the no-show's $5 deposit →
  **$4 to the party who showed + $1 to `PLATFORM_FEES` (recovery fee)**; refund the rest
  (the shower's escrow). `faultParty = the no-show`. State → `EXPIRED_NO_SHOW`.
- **neither showed** (`'both'`): refund everyone in full, **no capture, no fee, no fault**.
  State → `EXPIRED_NO_SHOW`. (Closes audit #15 for arranged deals.)

`noShowLedger` changes from `$5 → victim` to `$4 → victim, $1 → PLATFORM_FEES`; add a
mutual-refund path for `'both'`.

### 4. Worker

`dueTransition` gains a scheduled branch:

- **Scheduled + confirmed**, `now >= meetupTime + graceMs`, state ∈ {ARMED, EN_ROUTE}:
  - `buyerArrived && !sellerArrived` → `EXPIRE_NO_SHOW seller`
  - `sellerArrived && !buyerArrived` → `EXPIRE_NO_SHOW buyer`
  - neither → `EXPIRE_NO_SHOW both`
- **ASAP**: existing mutual-head-out gate (both headed out + one arrived + `noShowMs`),
  unchanged.

New window: `graceMs` (default 20 min) in `WorkerWindows`.

### 5. App

- The 2c auto-suggest card becomes **"propose spot + time"**: spot (auto #1 / custom) + a
  time control (**ASAP** | quick presets *in 1h* / *this evening* / *tomorrow AM* | custom).
- Counterparty gets a **Confirm meetup** prompt ("Maya proposes X at 3:00 PM").
- Show the agreed time + a **countdown** to T while ARMED/EN_ROUTE.
- **Reschedule** button (re-opens the propose flow).
- `HEAD_OUT` gate copy: needs a *confirmed* meetup.
- Forfeit copy is honest both ways: *"They didn't show — $4 of their $5 deposit comes to
  you; MeetMe keeps $1 to cover the failed transaction."*

### 6. Migration

Add `meetup_time`, `meetup_proposed_by`, `meetup_confirmed` columns to `deals`
(nullable / default false). Mirror in `supabase/migrations`. No enum change (reusing
`EXPIRE_NO_SHOW`); `apply_transition` handles the new fields via the deal JSON.

## Testing

- **core/machine**: PROPOSE→CONFIRM sets confirmed; CONFIRM by proposer rejected;
  reschedule resets confirmed; HEAD_OUT blocked until confirmed; `noShowLedger` splits
  $4/$1 and conserves; `'both'` refunds all and conserves.
- **worker**: scheduled no-show fires at T+grace for the absent party (one-sided);
  `'both'` when neither arrived; ASAP path unchanged; nothing before the grace.
- **payments**: the $1 recovery fee lands in `PLATFORM_FEES`; the $4 payout mirrors to the
  rail as `payout_buyer`/`payout_seller`.
- **live smoke**: unchanged completion path still conserves.

## Rollout notes

- Existing in-flight deals: `meetupConfirmed` defaults false → they'd need to arrange a
  meetup. Acceptable (prototype; no real deals in flight).
- `graceMs`/`noShowMs` are tunable constants.
