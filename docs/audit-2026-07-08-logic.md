# MeetMe logic-flaw audit — 2026-07-08

Focused correctness/logic pass (agent + hand-verified) after the meetup-timing, chat,
and QR-handoff features. Aesthetics excluded (separate UI sweep). `[V]` = verified in code.

## Fixed

- **[V] HIGH #1 — orphaned seller card hold (scheduled deals).** `holdRelease` gated on
  `sellerHeadedOut`, but scheduled deals place the $5 hold at `CONFIRM_MEETUP` (before
  head-out), so cancel/dispute/back-out never released it → $5 stuck on the seller's card.
  **Fix:** `holdRelease` now fires on `sellerHeadedOut || (meetupConfirmed && meetupTime)`;
  the CANCEL FUNDED/ARMED branch releases the hold. (`machine.ts`) + test.
- **[V] HIGH #2 — `split` dispute bypassed the settlement gate.** `releasesToSeller` only
  covered `release`, so a split paid the seller half the price from *unsettled* escrow.
  **Fix:** the gate now covers `split` too (both admin + self-service). (`payments.ts`) + test.
- **[V] MED #3 — ASAP "stall trap".** If the counterparty ghosted (never headed out), the
  waiting party's only exit forfeited their *own* $5. **Fix:** CANCEL from EN_ROUTE is a
  no-fault full refund unless the other side also headed out (mutual-commitment principle);
  added `EN_ROUTE→REFUNDED` to the transition table. (`machine.ts`, `states.ts`) + test.
- **[V] MED #4 — no server-side future-time guard.** `PROPOSE_MEETUP` accepted any time
  (client-only coercion). **Fix:** the machine rejects `time <= ctx.now`. + test.
- **[V] LOW #7 — stale seller copy.** Said the hold lands "when you head out"; scheduled
  deals place it at confirm. **Fix:** reworded to "a $5 hold backs this meetup" (accurate
  for both modes). (`AppContext.ts`, `dealLogic.ts`)

## Deliberately skipped

- **#5 — enforce `meetupConfirmed` in HEAD_OUT server-side.** Belt-and-suspenders: the
  money invariant is already protected (the scheduled forfeit checks `meetupConfirmed`; the
  ASAP forfeit requires both head-outs = mutual commitment). Enforcing it in the core would
  churn ~a dozen tests for near-zero real gain. Client already gates it.
- **#6 — binary geofence arrival.** Inherent to geofence-based arrival; an en-route-but-not-
  yet-arrived party reads as "not arrived." Tune `graceMs` if needed; no code change.

## Verified clean (no bug)

Scheduled clock is anchored to `meetupTime + grace`, NOT `updatedAt` — location pings and
chat messages don't reset any no-show clock. Double-hold prevention, the 6-digit wrong-code
guard, QR parse, reveal re-mint, ledger conservation, and the full-release settlement gate
all check out.

110 unit tests + live smoke + typecheck green.
