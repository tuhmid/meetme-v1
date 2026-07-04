# M1 — Backend: schema + auth + atomic transition handler

*Status: **core delivered & locally verified** (18/18 tests, typecheck clean). Live
Supabase provisioning is the operator's step — see `m1-supabase-wiring.md`.*

## Objective
Stand up the server boundary so M0's pure rules run **server-authoritatively** against
a real schema: every deal mutation goes through one place that **authorizes (who) →
validates (when, via @meetme/core) → persists atomically (all-or-nothing)**.

## Scope
**In:** the Postgres schema + RLS + ledger guard (SQL), the `@meetme/server`
transition handler + authorization + signup guards, an in-memory repo mirroring the
real adapter's atomic semantics, and tests.
**Out (later milestones):** the live Plaid money movement (M2), the app UI (M3),
push/realtime delivery and the Node worker (M4–M5). The handler is transport-agnostic.

## Deliverables
1. **`db/migrations/`** — `0001_schema.sql` (data model, cents as `bigint`, FKs,
   `public_profiles` view), `0002_rls.sql` (read-only-to-parties, no client writes
   to money tables, counterparty privacy), `0003_ledger_guard.sql` (deferred
   constraint trigger: every `txn_id`'s legs must sum to 0; `updated_at` touch).
2. **`@meetme/server`:**
   - `handler.ts` — `handleAction(repo, req, ctx)` (load → authorize → applyAction →
     atomic commit, optimistic-locked) + `createDealHandler`.
   - `authz.ts` — role/channel matrix (buyer-only / seller-only / either / system /
     admin).
   - `repo.ts` + `memoryRepo.ts` — persistence boundary + atomic in-memory impl.
   - `signup.ts` — one-account-per-phone, VoIP block, accept-terms at signup.
   - `ctx.ts` — server context (UUID ids, sha-256 hashed release codes).
3. **Tests** — happy path persisted + conserved; authorization; rejected-writes-nothing;
   optimistic-concurrency conflict; signup guards.

## Acceptance criteria (DoD)
- [x] `npm test` (18) + `npm run typecheck` pass.
- [x] Happy path `DRAFT → RELEASED` through the **handler** persists each step,
      conserves the ledger (balanced, escrow drains to 0), and applies effects
      (`completedDeals`).
- [x] **Authorization** enforced: wrong-role, non-participant, and user-fired
      system actions are rejected; you can't mark the other party arrived.
- [x] A **rejected** action persists nothing (state + version + ledger unchanged).
- [x] **Optimistic concurrency**: a stale commit raises `ConflictError`.
- [x] **Signup guards**: VoIP blocked, duplicate phone blocked, deal creation gated
      on accepted terms.
- [x] Release code stored **hashed**; plaintext returned once via `secret`.

## How this kills the carryover bugs at the persistence layer
- Server-supplied UUIDs (no client counters) · effects only inside the committed
  transaction (rejection writes nothing) · money tables unwritable by clients (RLS) ·
  counterparty private data never selectable (RLS + `public_profiles`) · ledger
  balance enforced by a DB trigger · concurrent transitions can't clobber (version).

## Verified locally vs needs the live project
- **Verified here:** handler logic, authorization, atomic semantics, signup, the SQL
  as artifacts.
- **Needs your Supabase project (M1 wiring doc):** apply migrations, the service-role
  Postgres `Repo` adapter, phone-OTP auth, Realtime subscriptions, and the HTTP/Edge
  entry point that calls `handleAction`.
