# M0 — Shared-core: plan & definition of done

*The milestone plan the build was executed against. Status: **COMPLETE** (13/13 tests, typecheck clean).*

## Why M0 first
- It's the **framework-agnostic spine** every other surface (app / web / server) builds on.
- It's **partner-agnostic** — no dependency on the fintech attorney or money partner, so it's safe to build *now*, in parallel with the legal/partner track.
- It's where most of the prototype's verified **Group-A carryover bugs die at the source** (see `~/p2p-escrow-prototype/V1_CARRYOVER.md`).

## Scope
**In:** pure domain logic + its tests.
**Out (later milestones):** database, network, Plaid, auth, UI, persistence, the Node worker, RLS. The core is deliberately **IO-free**.

## Deliverables
1. **Monorepo scaffold** — npm workspaces, TypeScript (strict), vitest; one-command `test` + `typecheck`.
2. **`@meetme/core` package:**
   - `states.ts` — `DealState`, `ALLOWED_TRANSITIONS`, `canTransition`, terminal set.
   - `money.ts` — integer **cents**; tiered fee + commitment (pure functions of price).
   - `types.ts` — `Deal`, `Action`, `Ctx`, `LedgerEntry`, `SideEffect`, `ApplyResult`.
   - `ledger.ts` — double-entry helpers; **escrow held is derived from state**, not stored.
   - `machine.ts` — `createDeal()` + `applyAction(deal, action, ctx)`: one pure, **guarded, atomic** transition.
3. **Tests** — happy path, money conservation, fee/commitment tiers, every edge flow, and the guard-invariant (carryover-bug) cases.

## Design principles (the "harden")
- **Integer cents**, never floats.
- **Pure / server-authoritative** — `ctx` injects `now`, `newTxnId`, `newCode`, `verifyCode` (deterministic; IDs/codes come from the server, never a module counter).
- **One atomic guarded transition** — a rejected action returns `{ok:false}` and changes nothing (no partial side-effects).
- **Double-entry ledger** — every txn's legs sum to zero → conservation provable.
- **Guards on every action**, not just state transitions.
- **Hashed release code**; plaintext returned once via `secret` for delivery to the buyer, never persisted.

## Acceptance criteria (Definition of Done)
- [x] `npm install`, `npm test`, `npm run typecheck` all pass.
- [x] Happy path `DRAFT → RELEASED` drives end-to-end; **ledger conserves; escrow drains to $0.**
- [x] $300 deal settles to the exact expected numbers (seller +$296, buyer −$304, platform +$8 at the $4/side tier).
- [x] Edge flows conserve money: **no-show** (no-show's $5 → company), **cancel/refund**, **dispute split**, **auto-release**.
- [x] Co-location gate: `AT_MEETUP` only after BOTH arrive.
- [x] Fee + commitment tiers correct at every boundary.
- [x] Every illegal action **rejects with zero side-effects**.

## Carryover Group-A bugs → impossible by construction
| Prototype bug | Killed in M0 by |
|---|---|
| id-collision destroyed escrow | IDs supplied by caller (`createDeal({id})`) |
| side-effects after a rejected transition | reject returns only `{ok:false}` — nothing to apply |
| no-show fires from ARMED | arrivals guarded to `EN_ROUTE`; `EXPIRE_NO_SHOW` explicit |
| guard bypass on non-transition mutations | `ARRIVE`/`REVEAL_CODE`/`SUBMIT_POSITION` state-guarded |
| negative balances / float `$NaN` | integer cents; escrow derived from state |
| money created/destroyed | balanced double-entry (`balanced()` asserts sum = 0) |
| plaintext release code | only `releaseCodeHash` stored; plaintext via `secret` once |

## Out-of-scope follow-ups (next milestones)
M1 wraps `applyAction` in a Postgres transaction behind RLS + phone auth · M2 Plaid sandbox maps `transfers` to the ledger · M3 walking skeleton. Money stays test-mode until M10 / attorney sign-off.
