# M8 — Disputes

The "something went wrong" flow — the last piece of the deal lifecycle (happy path +
no-show + **disputes**). The core state machine already supported it; M8 persists it
and puts a UI on it.

## What M8 adds

### Flow
1. **Open a dispute** — either party, from ARMED / EN_ROUTE / AT_MEETUP / CONFIRMING
   → `DISPUTED`, funds frozen. ("Report a problem" link in the app.)
2. **Both statements** — each side submits their account (`SUBMIT_POSITION`);
   statements are persisted and shown to both.
3. **Resolution** — support/admin decides **release / refund / split**; the ledger
   moves accordingly and the deal → `DISPUTE_RESOLVED`.

### Persistence (the new part)
Three new pure side-effects — `dispute_opened`, `dispute_position`,
`dispute_resolved` — are applied inside the atomic `apply_transition` RPC
(migration `0011`), writing to the `disputes` + `dispute_positions` tables (created
back in `0001`). `getDeal` now loads `disputePositions` (join through `disputes`),
so both phones see the running record. MemoryRepo carries positions on the deal, so
tests and prod behave the same.

### Resolution endpoint
`POST /dev/deals/:id/resolve { outcome }` (dev/`allowDev`-gated) stands in for the
**support/admin console** — it fires `RESOLVE_DISPUTE` as an `admin` channel action.
In the app this shows as a "Support decision (demo)" control on a disputed deal; in
production this is an internal admin tool, not a user action.

### App
Deal screen: a subtle **"Report a problem"** link on active deals; a red **dispute
panel** when DISPUTED (both statements + a box to add yours + the demo resolve
buttons); a green **resolved** note on DISPUTE_RESOLVED.

## Notable fix
Transfer **direction** was labeled from the action type (only RELEASE → seller
payout), so a dispute **split** tagged the seller's half as `refund_buyer`. Now the
direction follows the **recipient** — credit to the seller = `payout_seller`, to the
buyer = `refund_buyer` — correct across release, split, no-show, and cancel.

## How it was verified
- `npm test` — **54 pass** (core dispute effects + empty-statement reject; HTTP
  open → 2 statements → support-refund flow).
- **Live over HTTP:** opened a dispute → `DISPUTED`, both statements persisted to
  Postgres and read back, support **split** → `DISPUTE_RESOLVED` with the ledger
  split (buyer $209 / seller $205 for a $400 item). smoke green; app typechecks +
  bundles, doctor 18/18.

## Deferred (see `docs/PLACEHOLDERS.md`)
- **Self-service resolution** (both parties propose the same outcome → auto-resolve)
  and a real **admin console** — the dev endpoint is the stand-in.
- Evidence attachments (photos) on statements; SLA/escalation tiers.
- Ratings UI, real geographic map, hosted SMS/push.
