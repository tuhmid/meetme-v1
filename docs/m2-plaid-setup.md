# M2 — wiring Plaid (sandbox) on your end

The rail layer is done and tested with `FakeRail`. To move real (sandbox) money,
do these in your own Plaid account. Nothing here is needed to keep the tests green.

## 1. Get sandbox credentials
- Sign up at **dashboard.plaid.com** → you start in **Sandbox** (free, fake banks).
- Copy **client_id** and the **sandbox secret** (Team Settings → Keys).
- Add to `.env` (gitignored):
  ```
  PLAID_CLIENT_ID=...
  PLAID_SECRET=...
  PLAID_ENV=sandbox
  ```
- Request access to the **Transfer** and **Signal** products (sandbox is self-serve).

## 2. The Link flow (connect a bank) — needed before any transfer
1. **Server:** `linkTokenCreate({ products: ['transfer'], ... })` → `link_token`.
2. **App:** open Plaid Link with that token; the user "logs in" to a sandbox bank
   (e.g. `user_good` / `pass_good`) → Link returns a `public_token` + `account_id`.
3. **Server:** `itemPublicTokenExchange({ public_token })` → **`access_token`**.
4. **Store** `access_token` + `account_id` **server-side, encrypted** (add an
   encrypted column or a secrets vault; do NOT put it in the client). The
   `payment_methods` table holds the non-secret refs.

## 3. Provide `getBank` and swap the rail
`PlaidRail` needs to resolve a user's tokens:
```ts
import { makePlaidRail } from '@meetme/server';
const rail = makePlaidRail({
  clientId: process.env.PLAID_CLIENT_ID!,
  secret: process.env.PLAID_SECRET!,
  env: 'sandbox',
  getBank: async (userId) => {
    // load access_token + account_id (decrypted) + legal_name for this user
    return { accessToken, accountId, legalName };
  },
  fundingNetwork: 'ach',   // 'rtp' where eligible (instant, irreversible)
  payoutNetwork: 'rtp',
});
// then use executeAction(repo, rail, req, ctx) instead of the FakeRail
```

## 4. Webhooks — drive settlement
- Set a **Transfer webhook** URL in the Plaid dashboard.
- On `transfer.events` (e.g. `posted` → `settled`, or `returned`), call
  `markFundingSettled(repo, dealId)` / `markFundingReturned(repo, dealId)` (or update
  the matching transfer by `idempotency_key`). The M5 worker also polls
  `transferEventsSync` as a backstop.

## 5. Verify the scaffold
`PlaidRail` builds the right calls (Signal evaluate → authorization create → transfer
create → transfer get) but request bodies are cast to `any` — run a sandbox transfer
end to end and tighten the fields against the live SDK responses. Then the same
`executeAction` flow (gate + ledger mirror) you already tested with `FakeRail` runs on
real rails.

## Notes
- **RTP/FedNow** are instant + irreversible (no Signal risk, no return) — prefer them
  where the bank supports it; **ACH** is the fallback (Signal-gated, settles in days,
  payout held until settled).
- Sandbox lets you force transfer events (settle/return) to test the gate.
