# M2 — money rails (sandbox)

*Status: **rail layer delivered & verified with FakeRail** (24 tests). `PlaidRail` is
a real scaffold to finish against your Plaid sandbox — see `m2-plaid-setup.md`.*

## Objective
Make money actually move (in test mode) behind a rail-agnostic boundary, and enforce
the **payout-settlement policy** so the seller is never paid before the buyer's funds
clear.

## Scope
**In:** the `PaymentRail` interface; a `FakeRail` (testable, instant/ACH/risk/return);
a `PlaidRail` scaffold (Signal + Transfer); `transfers` persistence; the `executeAction`
orchestration with the risk gate + settlement gate + ledger-mirrored payouts/refunds.
**Out (later):** the Link UI + token exchange + webhooks + settlement polling (the
worker, M5); Stripe-cards (fast-follow); KYC/IDV (its own integration).

## Design
- **Ledger = accounting truth** (written by `@meetme/core` on each transition).
  **Transfers = rail execution** (`transfers` table, pending → settled/returned).
  The orchestration mirrors the ledger's bank credits onto the rail, so the two can
  never disagree; reconciliation (M9) audits it.
- **Funding pull** on FUND, **after a Signal risk gate** (decline ≥ threshold).
- **Release is BLOCKED until the funding transfer is `settled`** (instant for
  RTP/FedNow; after the settle webhook for ACH). This is the anti-loss gate.
- **Payouts/refunds** are pushed from the committed ledger's bank credits.

## Deliverables
- `rails/rail.ts` — `PaymentRail` interface + types + `RISK_DECLINE_THRESHOLD`.
- `rails/fakeRail.ts` — deterministic in-memory rail (instant vs ACH, risk, settle/return).
- `rails/plaidRail.ts` — Plaid Transfer + Signal scaffold (gated; verify in sandbox).
- `transfers` repo methods (interface + memory + supabase).
- `payments.ts` — `executeAction`, `markFundingSettled`, `markFundingReturned`.
- `payments.test.ts` — 5 tests.

## Acceptance criteria (DoD)
- [x] Instant rail (RTP): fund settles immediately → release → seller payout. Amounts
      exact (fund $309, payout $301, buyer commitment $5 back).
- [x] **Payout-settlement gate**: ACH funding pending → release returns
      `funding_not_settled`; after `markFundingSettled`, release succeeds + payout fires.
- [x] **Risk gate**: Signal score ≥ threshold → FUND `risk_declined`, no state change.
- [x] **Return safety**: a returned ACH funding keeps the gate shut → seller never paid.
- [x] **Refund push**: cancel-after-funding mirrors the ledger refund onto the rail.
- [x] typecheck clean; PlaidRail compiles.

## Verified locally vs needs your Plaid account
- **Verified:** the whole rail layer via `FakeRail` (no external account).
- **Needs Plaid sandbox creds (m2-plaid-setup.md):** run `PlaidRail`, the Link/token
  flow, the Transfer webhook, then swap `FakeRail` → `makePlaidRail(...)`.
