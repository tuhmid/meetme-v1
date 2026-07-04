# M5 — Real auth, live sync, self-driving deals, push

**Goal:** make it real. Real phone-OTP identity (which unlocks true Realtime), a
background worker that moves deals on their own, and push notifications. Your
scope calls: **real auth + Realtime now**, and **wire push now (you'll do a dev
build to receive it)**.

## What M5 adds

### 1. Background worker (fully server-side, fully tested)
`@meetme/server` `worker.ts`: a pure `dueTransition(rec, now, windows)` decides the
single timed transition due for a deal, and `runWorkerOnce(repo, rail, makeCtx)`
drives it:
- **No-show expiry** — EN_ROUTE with one party arrived and the other absent past
  `noShowMs` (30 min) → `EXPIRE_NO_SHOW` on the absent party (their $5 commitment
  goes to the company; the present party is fully refunded). Neither arrived → no
  clear fault, left for a manual cancel.
- **Confirm-window auto-release** — CONFIRMING past `confirmMs` (60 min) →
  `AUTO_RELEASE`.
- **Settlement sync** — pending funding whose rail now reports `settled` is synced
  so the payout-settlement gate can open (a Plaid webhook does this in prod).
Runs on a timer: `npm run worker:dev`. Timing comes from a new `updatedAt` on
`DealRecord` + `repo.listActiveDeals()`.

### 2. Real phone-OTP auth (dev-login still available)
- Supabase Auth phone OTP. Locally, `[auth.sms.test_otp]` gives fixed codes for
  demo numbers (`+15551230001…04`, code `123456`) — **no SMS provider, no cost**.
  (The Twilio block is enabled with placeholder creds only because GoTrue requires
  a provider to be "configured"; test-OTP numbers never actually call it.)
- Migration `0008_auth_profile.sql`: a trigger mirrors each new `auth.users` row
  into `public.users` keyed to `auth.uid()`, so RLS's `auth.uid() = users.id`
  holds. Name comes from signup metadata; terms accepted at signup. No hard FK, so
  dev/test users (server-minted) still coexist.
- The API already verifies a real Supabase JWT (`makeSupabaseTokenVerifier`); the
  `dev:<userId>` shortcut stays for Demo mode.
- Create a deal by **counterparty phone** (`POST /deals` resolves phone → user id).

### 3. True Realtime
Once the app holds a real Supabase session, it subscribes to `deals`/`transfers`
`postgres_changes` for the open deal — RLS delivers only rows the party may see.
Demo mode (no session) keeps the M4 polling fallback.

### 4. Push notifications
- `push_tokens` repo + `POST /push-token` (register a device's Expo token).
- `pushExpo.ts` (`PushSender` + `makeExpoPushSender` posting to Expo's push API) +
  `notify.ts` (`notifyDealState` — one message per state, to both parties,
  best-effort). Wired into the API actions/co-location and the worker.
- App registers for push on login (`expo-notifications`).
- **Delivery needs a dev build** — Expo Go on SDK 54 can't receive remote push. The
  token registration + server send are verified; on-device receipt is the dev-build
  step (see README).

## App
Login screen (name + phone → OTP → verify) **or** "Demo mode (Maya & Sam)". Real
mode: one identity, deal-by-phone, Realtime live sync, push registration, Log out.
Session persists across restarts (AsyncStorage). New deps: `@supabase/supabase-js`,
`@react-native-async-storage/async-storage`, `react-native-url-polyfill`,
`expo-notifications`, `expo-device`.

## How it was verified
- `npm test` — **45 pass** (6 new worker tests: pure timing + no-show + auto-release
  + ACH settlement-then-release + no-op; 3 push/notify tests).
- **Live real-auth over HTTP:** two users signed in via phone OTP, registered a push
  token, created a deal **by phone**, drove it through geofence + buyer-only code to
  `RELEASED` (transfers fund $309 / payout $301 / refund $5) — all with real JWTs.
- **Live worker:** drove a deal to CONFIRMING via the API, ran `runWorkerOnce` past
  the confirm window → `released 1`, deal `RELEASED`.
- `npm run smoke` still green; app typechecks + bundles (774 modules), doctor 18/18.

## Deferred
- **Hosted SMS** (Twilio) — only needed off-localhost.
- **On-device push receipt** — needs your EAS/dev build (steps in the app README).
- Dispute UI / admin resolution (M6), KYC step-up, richer trust (later).
