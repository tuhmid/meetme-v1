# M3 — Walking skeleton

**Goal:** one continuous, tappable path from "propose a deal" to "money released,"
running over real HTTP against the real local Postgres. Prove the spine end-to-end
before we add the hard parts (geolocation, push, disputes). Nothing here is new
business logic — M3 wires M0's rules + M1's repo + M2's money rails behind an HTTP
API and puts a thin UI on top.

## What M3 adds

```
apps/app  (Expo / React Native)  ── HTTP ──▶  apps/api (Fastify)
   thin client, no rules                          │
                                                   ├─ @meetme/server  (handler, authz, payments)
                                                   ├─ @meetme/core    (state machine, ledger, money)
                                                   ├─ supabaseRepo     ──▶  Postgres (apply_transition RPC)
                                                   └─ FakeRail         (rtp, instant settle)
```

### 1. HTTP API (`apps/api`, Fastify)

`buildServer({ repo, rail, makeCtx, allowDev })` returns a Fastify app so tests can
inject fakes. Routes:

| Method | Path                               | Purpose                          |
| ------ | ---------------------------------- | -------------------------------- |
| POST   | `/signup`                          | create a user (phone + name)     |
| POST   | `/deals`                           | propose a deal (buyer → seller)  |
| GET    | `/deals`                           | list my deals                    |
| GET    | `/deals/:id`                       | deal + its transfers             |
| POST   | `/deals/:id/actions`               | apply one action to the machine  |
| POST   | `/dev/deals/:id/settle-funding`    | dev-only: mark funding settled   |
| POST   | `/dev/deals/:id/return-funding`    | dev-only: simulate an ACH return |

Auth for the skeleton is a dev bearer token: `Authorization: Bearer dev:<userId>`.
That's a stand-in — real Supabase-Auth JWT verification lands in M4. The `/dev/*`
routes are gated behind `allowDev` so they can never ship to prod.

### 2. Thin client (`apps/app`, Expo)

Single-device, two-party relay: one person drives both sides with a "Viewing as"
toggle. Screens: login (sign up Maya + Sam) → home (list + create) → deal (state,
contextual action buttons, live transfers). The client mirrors only *which button
to show*; it never decides whether an action is legal — the server does, and a
rejected action surfaces as an inline error.

## How it was verified

- `apps/api/src/server.test.ts` drives a full deal through `app.inject` (in-process
  HTTP) end to end to `RELEASED`, plus an auth-rejection test. Part of `npm test`.
- Booted `npm run api:dev` against the live local Supabase + FakeRail and ran a
  two-party deal over real HTTP (curl): deal reached `RELEASED`; transfers settled
  `fund_buyer $309 / payout_seller $301 / refund_buyer $5`; `GET /deals` listed it.

## Deliberately deferred

- **Real auth** (Supabase JWT) → M4. Dev bearer token only for now.
- **Geolocation / auto-arrival / push** → M4. Arrival is a manual button here.
- **Realtime** (two live devices) → M4. Single-device relay for now.
- **Release-code delivery to the buyer only** → M4. Today the code is surfaced to
  the demoer at POST_STAKE; the seller must never see the plaintext in the real app.
- **Background worker** (timeouts, no-show expiry) → M5.

## Status

✅ API spine built and tested (25 tests green). ✅ Proven end-to-end over real HTTP
against local Postgres. ✅ Expo client on **SDK 54** (RN 0.81 / React 19) — deps
installed, `expo-doctor` passes all 18 checks, app typechecks clean; launch with
`npx expo start` and scan the QR in Expo Go (see `apps/app/README.md`).
