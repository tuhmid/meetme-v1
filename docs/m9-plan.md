# M9 — Ratings

Closes the post-deal loop: after a deal finishes, each party rates the other, and a
**trust score** (reputation) accrues on the account. Most of this already existed in
the core (`RATE` action + trust math + persistence) — M9 exposes it in the app.

## What M9 adds

### Rate after a deal
On `RELEASED` / `DISPUTE_RESOLVED`, the deal screen shows a **star picker** if you
haven't rated yet (1–5 → `RATE` action). Once rated, it shows "You rated N★." You
can rate once; out-of-range or pre-completion ratings are rejected by the core.

### Reputation everywhere
`GET /deals/:id` now returns each party's **trustScore** and **completedDeals**, and
the deal screen shows the counterparty's reputation up top:
`Sam · trust 100/100 · 3 deals`. That's the "should I trust this stranger" signal —
it pairs with the escrow trust banner from M7.

### How the score works (already in core/db)
`RATE` emits a `rating` side-effect; `apply_transition` inserts into `ratings` and
recomputes `trust_score = round(avg(stars)/5*100)` for the ratee. New users start at
50; a 5★ average → 100, a 4★ average → 80.

## No new migration
Ratings tables + the `rating` effect handling have existed since `0001`/`0004`. M9 is
app + one additive field on the deal-detail response.

## How it was verified
- `npm test` — **56 pass** (core: rate once / double / out-of-range / not-completed;
  HTTP: both sides rate after release → trust scores update to 100 and 80).
- **Live over HTTP:** completed a deal, both rated (5★ / 4★) → Sam trust 100, Maya
  trust 80, double-rate rejected (409). smoke green; app typechecks + bundles,
  doctor 18/18.

## Deferred (see `docs/PLACEHOLDERS.md`)
- Rating **comments** (free-text) and showing a rating **history** on a profile.
- A real profile screen (currently reputation shows inline on the deal).
- Real geographic map (Maps key), self-service dispute resolution, hosted SMS/push.
