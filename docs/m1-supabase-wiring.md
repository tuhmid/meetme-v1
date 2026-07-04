# M1 — wiring `@meetme/server` to a live Supabase project

The handler + schema are done and tested with the in-memory repo. To run against a
real database, do these steps in your own Supabase project (needs your account + keys).

## 1. Create the project & apply migrations
```bash
# Supabase CLI
supabase init
cp db/migrations/*.sql supabase/migrations/   # 0001 schema, 0002 rls, 0003 ledger guard
supabase db push                              # or run them in the SQL editor in order
```
Enable **Phone auth** (Auth → Providers → Phone) with an SMS provider (Twilio).

## 2. Implement the Postgres `Repo` (service role)
Create `packages/server/src/supabaseRepo.ts` implementing the `Repo` interface from
`repo.ts`, using `@supabase/supabase-js` with the **service-role key** (bypasses RLS;
server-only, never shipped to the client). `commit()` must run in **one transaction**
via an RPC/Postgres function, e.g. `apply_transition(p_deal_id, p_expected_version,
p_deal jsonb, p_events jsonb, p_ledger jsonb, p_effects jsonb)` that:
1. `select version ... for update` and check `= p_expected_version` (else raise → maps to `ConflictError`),
2. update the deal row, insert events, insert ledger legs (the balance trigger fires at commit),
3. apply effects (completed_deals++, trust deltas, ratings), all in the function body.

This keeps the atomicity the in-memory repo simulates. `@meetme/core` stays the only
source of the rules; the RPC is just persistence.

## 3. Entry point
A thin HTTP route (or Supabase Edge Function) that:
- verifies the caller's Supabase JWT → `callerUserId`, `channel = 'user'`,
- builds `ServerCtx` (`makeServerCtx()`),
- calls `handleAction(supabaseRepo, { dealId, action, callerUserId, channel }, ctx)`,
- returns the result (delivering `secret.releaseCode` to the buyer only).
System/admin channels (worker, admin console) use a separate authenticated path.

## 4. Realtime
Clients subscribe to their `deals` + `deal_events` rows (RLS already scopes them).
No extra server code — Supabase Realtime streams the row changes the handler writes.

## 5. Sanity checks
- A client cannot `insert/update` `deals`/`ledger_entries` directly (RLS denies).
- A client cannot select the counterparty's `users` row (only `public_profiles`).
- An unbalanced ledger write is rejected by the `ledger_txn_balanced` trigger.
