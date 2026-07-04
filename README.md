# MeetMe v1 (monorepo)

Real v1 of MeetMe — the P2P escrow + safe-meetup trust layer. Built from the plan
in the prototype repo (`~/p2p-escrow-prototype/docs/v1-PRD.md`).

## Status — M0: shared-core ✅

`packages/core` (`@meetme/core`) is the framework-agnostic spine the app, web, and
server all build on. It's **pure and server-authoritative**:

- **`states.ts`** — the deal state machine + `ALLOWED_TRANSITIONS`.
- **`money.ts`** — integer **cents**; tiered fee + commitment (no floats).
- **`ledger.ts`** — double-entry helpers; escrow held is **derived from state**, never a stored balance.
- **`machine.ts`** — `applyAction(deal, action, ctx)`: ONE pure, **guarded, atomic**
  transition. A rejected action changes nothing (no partial side-effects). Returns a
  description of changes (next deal + events + balanced ledger legs + user effects)
  for the server to apply in a single DB transaction. IDs/codes/time are injected via
  `ctx` (deterministic; no client-side id counters).

This design makes the prototype's verified Group-A bugs **impossible by construction**
(see `~/p2p-escrow-prototype/V1_CARRYOVER.md`): server-supplied IDs, money in cents,
guards on every action, side-effects only on commit, conservation provable.

## Run

```bash
npm install
npm test        # vitest — state machine + money conservation + guard invariants
npm run typecheck
```

## Status — M1: backend ✅ (running on local Supabase)

`db/migrations/` (schema + RLS + ledger guard + `apply_transition` RPC + grants) and
**`packages/server`** (`@meetme/server`) add the server boundary: one **atomic
transition handler** that authorizes (who) → runs `@meetme/core` `applyAction` (when)
→ persists deal + events + ledger + effects all-or-nothing, optimistic-locked. Plus
signup guards (one-account-per-phone, VoIP block, accept-terms). Verified two ways:
an in-memory repo (unit tests) **and a live local Supabase** (`supabaseRepo` +
`apply_transition` RPC), where a real deal runs `DRAFT → RELEASED` in Postgres with
the ledger conserving. Plan: `docs/m1-plan.md` · local dev: `docs/m1-local-dev.md` ·
hosted: `docs/m1-supabase-wiring.md`.

### Local dev loop (needs Docker running)
```bash
npm install
npm run db:start     # boots local Supabase (Postgres+Auth+Realtime+Studio) + applies migrations
cp .env.example .env # already filled with local default keys if you used db:start output
npm run db:studio    # open Studio at http://127.0.0.1:54323
npm test             # unit tests (smoke skips without DB env)
npm run smoke        # one real deal through local Postgres (uses .env)
npm run db:reset     # wipe + reapply all migrations
npm run db:stop      # stop the stack
```

## Status — M2: money rails ✅ (verified with FakeRail)

`packages/server/src/rails/` + `payments.ts` add a rail-agnostic money layer:
`PaymentRail` interface, a deterministic **`FakeRail`** (tested), and a **`PlaidRail`**
scaffold (Transfer + Signal). `executeAction` wraps the handler with a **funding pull
+ Signal risk gate**, the **payout-settlement gate** (release blocked until the
buyer's funds settle — never pay before money clears), and **payouts/refunds mirrored
from the committed ledger**. Plan: `docs/m2-plan.md` · Plaid sandbox wiring:
`docs/m2-plaid-setup.md`.

## Status — M3: walking skeleton ✅ (proven end-to-end over real HTTP)

`apps/api` (Fastify) puts the spine behind HTTP: signup, create/list/get deals,
apply-action, and dev-only settle/return-funding routes. `buildServer({repo, rail,
makeCtx, allowDev})` is injectable for tests; dev auth is a `Bearer dev:<userId>`
token (real Supabase-Auth JWT lands in M4). `apps/app` (Expo / React Native) is the
thin tap-through client — single-device, two-party relay (one person drives both
sides via a "Viewing as" toggle), holding no rules or money logic. Verified with
in-process `app.inject` tests **and** by booting `npm run api:dev` against live local
Postgres + FakeRail and driving a deal `DRAFT → RELEASED` over real curl HTTP
(transfers settled `fund_buyer $309 / payout_seller $301 / refund_buyer $5`). Plan:
`docs/m3-plan.md` · run the app: `apps/app/README.md`.

```bash
npm run db:start     # local Supabase
npm run api:dev      # API on http://localhost:8787
cd apps/app && npm install && npx expo start   # the UI (separate install — outside root workspaces)
```

## Status — M4: identity, presence, live updates ✅

Adds the two-phone layer (scoped: **JWT plumbing keeping dev-login**, **in-app
alerts now / push in M5**):
- **Auth** — `buildServer` resolves a real Supabase JWT (`makeSupabaseTokenVerifier`
  → `auth.uid()`) **or** the `dev:<userId>` shortcut. Production path wired + tested;
  phone-OTP login screen is a later pass.
- **Geofence** — pure `@meetme/core` geo helpers + a system-only **`CO_LOCATED`**
  action; `POST /deals/:id/location` stores each party's latest ping
  (`deal_locations`, RLS-locked) and auto-arrives both when they come together.
  Raw coordinates are never exposed — only the distance-between + new state.
- **Realtime** — `deals`/`transfers`/`deal_events` added to the `supabase_realtime`
  publication (RLS-scoped). App uses **polling** for now (dev-login has no Supabase
  session → RLS-gated Realtime can't reach an anon client); infra is ready for real
  auth. In-app banners flash on state changes.
- **Buyer-only code** — the release code is minted at **`REVEAL_CODE`** (buyer
  action) and returned to the buyer only; the seller learns it in person. Only the
  hash is ever stored.

Verified: **36 tests + live-Postgres smoke** (smoke now runs the geofence path),
Realtime publication confirmed, app typechecks/bundles clean. Plan: `docs/m4-plan.md`.

## Status — M5: real auth, live sync, self-driving deals, push ✅

- **Background worker** (`@meetme/server` `worker.ts`, run with `npm run worker:dev`)
  — no-show expiry, confirm-window auto-release, funding-settlement sync. Pure timing
  (`dueTransition`) + a driver (`runWorkerOnce`); fully tested and verified auto-
  releasing a live CONFIRMING deal.
- **Real phone-OTP auth** — Supabase Auth phone OTP; locally uses fixed test codes
  (`+15551230001…04`, code `123456`, no SMS bill). Migration `0008` mirrors each
  auth user into `public.users` (id = `auth.uid()`). The API verifies real JWTs;
  `dev:<userId>` stays for Demo mode. Deals can be created **by counterparty phone**.
- **True Realtime** — a logged-in app subscribes to `deals`/`transfers` changes
  (RLS-scoped); Demo mode keeps polling.
- **Push** — `push_tokens` + `POST /push-token` + Expo push send (`notifyDealState`),
  wired into actions and the worker. On-device receipt needs a **dev build** (Expo
  Go can't; see `apps/app/README.md`).

Verified: **45 tests + live smoke**, plus a live end-to-end real-auth deal over HTTP
(phone-OTP JWTs → deal-by-phone → geofence → buyer-only code → RELEASED) and a live
worker auto-release. Plan: `docs/m5-plan.md`.

```bash
npm run db:start && npm run api:dev      # DB + API
npm run worker:dev                       # (another terminal) timers/settlement
cd apps/app && npx expo start            # the app — Sign in with phone, or Demo mode
```

## Status — M6: presence, invites, draft cleanup ✅

- **Live presence** — per-party "headed out" (migration `0009`); EN_ROUTE shows both
  sides' status (not-left → heading over → arrived), so one tapping "I'm heading
  out" reflects on the other's phone.
- **Invites** — `invites` table (migration `0010`) + `POST /invites` (by phone),
  in-app inbox (`GET /invites`), `POST /invites/:token/accept` (creates the shared
  deal). App offers a skippable native-SMS nudge; no Twilio.
- **Delete drafts** — `DELETE /deals/:id` for DRAFTs only (active → 409); swipe-left
  to delete in the app.

Invites work **both ways** (inviter chooses buyer or seller; invitee is told which
side they'll take) and deals carry their **own item + price** (nothing hardcoded).
Verified: **51 tests + smoke**, plus a live invite→accept (incl. seller-initiated,
custom amount), draft delete, and per-party head-out flow over HTTP. Plan:
`docs/m6-plan.md`.

📋 **All demo shortcuts / deferred functionality are tracked in
[`docs/PLACEHOLDERS.md`](docs/PLACEHOLDERS.md)** — the single list to revisit.

## Status — M7: trust + live-map UI ✅

- **Escrow trust signal** — a shield banner on every deal ("Your $220.00 is safe in
  escrow", perspective-aware) → taps into a "how your money stays safe" explainer.
- **Live presence card** — the mockup's map look: LIVE header, dashed route to the
  pin, both avatars (real initials) positioned by *not-left → heading over →
  arrived*, with distance on your own. `GET /deals/:id` now returns buyer/seller
  names for the avatars.
- **Icons + exact money** — `@expo/vector-icons` (no emoji); every amount renders
  exact (`$220.00`), never rounded.

Verified: **51 tests + smoke**, app typechecks/bundles, `expo-doctor` 18/18. Plan:
`docs/m7-plan.md`. (The map is a stylized presence card, not a geographic map yet —
see `docs/PLACEHOLDERS.md`.)

## Status — M8: disputes ✅

The full deal lifecycle now includes the "something went wrong" path: either party
opens a dispute (ARMED…CONFIRMING → `DISPUTED`, funds frozen), both submit
statements (persisted via `apply_transition` → `disputes`/`dispute_positions`,
migration `0011`), and support resolves **release / refund / split** →
`DISPUTE_RESOLVED` with the ledger moving accordingly. App: "Report a problem" →
dispute panel (statements + resolve). Resolution endpoint is dev-gated (stands in
for an admin console). Also fixed transfer-direction labeling (recipient-based).

Verified: **54 tests + smoke**, plus a live open→statements→split resolution over
HTTP. Plan: `docs/m8-plan.md`.

## Status — M9: ratings ✅

Closes the post-deal loop: on `RELEASED`/`DISPUTE_RESOLVED` each party rates the
other (star picker → `RATE`), and a **trust score** accrues on the account
(`round(avg(stars)/5*100)`). The deal screen shows the counterparty's reputation
(`trust /100 · N deals`) — the "trust a stranger" signal. Backend/persistence
pre-existed; M9 exposes it + adds trust to the deal-detail response.

Verified: **56 tests + smoke**, plus a live both-sides-rate flow (trust → 100 / 80).
Plan: `docs/m9-plan.md`.

## Status — real map ✅ (Geoapify / OpenStreetMap, free)

During a meetup (EN_ROUTE/AT_MEETUP), the deal screen shows a **real OSM map** with a
marker per party — a Geoapify **Static Maps** image the server builds from the live
location pings (key server-side in `.env` as `GEOAPIFY_KEY`; shown only to
participants). Falls back to the stylized card before anyone shares location.
Verified live end-to-end (server returns a `mapUrl` → a real ~90 KB JPEG). Interactive
pan/zoom is deferred (needs a dev build).

## Status — back-out rules, invite decline, KYC, self-service disputes ✅

- **Back-out / cancel** (rules reviewed): free full refund **before** heading out;
  **forfeit your commitment after** heading out (self-declared no-show). Full rules:
  `docs/deal-rules.md`.
- **Invite decline** — invitee can dismiss an invite (inviter can rescind).
- **KYC step-up** — deals over **$500** require the creator to be ID-verified
  (`kyc_required`); a one-time verify bumps the tier (verify step mocked).
- **Self-service disputes** — both parties propose an outcome; matching proposals
  **auto-resolve by agreement** (no admin); admin/support decision is the fallback.

Verified: **63 tests + smoke**, plus live checks of all four. Full deal economics:
`docs/deal-rules.md`.

## Next milestones

Hosted SMS/push, MapLibre interactive map (dev build), then compliance, launch (see
`~/p2p-escrow-prototype/docs/v1-build-sequence.md`). A dedicated **UI/design pass** is
planned once functionality is complete. Money stays test-mode until fintech-attorney
sign-off.
