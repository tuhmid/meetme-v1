# MeetMe architecture — the system on one page

## Design principles

- **Server-authoritative, pure state machine.** All deal rules live in `@meetme/core` as one pure function: `applyAction(deal, action, ctx) → result`. A rejected action changes *nothing*; a successful one returns a *description* of the changes (next deal, events, ledger legs, side-effects). Clients hold no rules or money logic.
- **Double-entry ledger in integer cents.** Every money movement is a set of signed ledger entries that sum to zero per transaction — money is conserved and provable. No floats anywhere. Escrow held is *derived* from deal state, never a stored balance.
- **Effects applied atomically with transitions.** The server persists a transition via the `apply_transition` Postgres RPC: optimistic version check, deal update, event append, ledger insert (a deferred DB trigger rejects unbalanced transactions at COMMIT), and user side-effects — all in one DB transaction. A version conflict surfaces as a retryable `conflict` error.
- **Money moves only through a `PaymentRail` adapter.** The core/ledger record accounting truth; a rail *executes* it. `FakeRail` (deterministic, in-memory) is the only rail wired today; a `PlaidRail` scaffold exists, and the seller card mechanic maps to Stripe SetupIntent + manual-capture PaymentIntent later.
- **No PII leaks in public endpoints.** Profiles expose name + trust signals, never phone numbers; card details are self-only; a party never sees the counterparty's raw coordinates (only distance-between); the release code is returned once to the buyer and only its hash is stored.

## Deal state machine

```
                                 CANCEL (free)
 DRAFT ──ACCEPT_TERMS──▶ AGREED ──FUND──▶ ARMED ──HEAD_OUT──▶ EN_ROUTE ──▶ AT_MEETUP
   │                       │                │                    │    (ARRIVE both /    │
   └──▶ CANCELLED ◀────────┘                └──▶ REFUNDED        │     CO_LOCATED)      │ REVEAL_CODE +
                                                (CANCEL = free   │                      ▼ ENTER_CODE
                                                 full refund)    │                  CONFIRMING
                                                                 │                      │ CONFIRM_RECEIVED /
                                CANCEL after head-out = no-show  │                      ▼ AUTO_RELEASE (worker)
                                                                 ▼                   RELEASED
                                                        EXPIRED_NO_SHOW
                                                        (also via worker)

 ARMED / EN_ROUTE / AT_MEETUP / CONFIRMING ──OPEN_DISPUTE──▶ DISPUTED ──▶ DISPUTE_RESOLVED
                                                             (funds frozen)   (agreement or admin:
                                                                               release/refund/split)
```

Terminal states: `RELEASED`, `CANCELLED`, `REFUNDED`, `EXPIRED_NO_SHOW`, `DISPUTE_RESOLVED`. A `FUNDED` state remains in the enum for backward compatibility, but nothing transitions into it anymore — `FUND` arms the deal directly (no seller stake turn).

**Actions and who may call them** (`packages/server/src/authz.ts` — the machine validates *when*, authz validates *who*):

| Action | Caller |
|---|---|
| `ACCEPT_TERMS`, `ENTER_CODE` | seller only |
| `FUND`, `REVEAL_CODE`, `CONFIRM_RECEIVED` | buyer only |
| `HEAD_OUT`, `SET_MEETUP`, `OPEN_DISPUTE`, `SUBMIT_POSITION`, `PROPOSE_RESOLUTION`, `CANCEL`, `RATE` | either participant (the `actor` must be the caller) |
| `ARRIVE` | either participant (only for themselves) |
| `CO_LOCATED`, `EXPIRE_NO_SHOW`, `AUTO_RELEASE` | system only (worker / location service) |
| `RESOLVE_DISPUTE` | admin or system |

## Money

The complete rules — tiers, deposits, every outcome — live in [`deal-rules.md`](deal-rules.md). The mechanics:

**Ledger accounts:** `bank:<userId>` (a user's external money), `escrow:<dealId>` (per-deal escrow), `platform:fees` (earned fees), `platform:penalty` (absorbed losses).

**Where money moves on each outcome** (all legs per txn sum to zero):

| Outcome | Escrow → | Seller card hold |
|---|---|---|
| `RELEASED` (confirm / auto-release / dispute-release) | seller: price − seller fee · buyer: deposit − buyer fee · platform: total fee | released |
| `REFUNDED` (cancel before head-out / dispute-refund) | buyer: price + deposit, in full — no fees | released |
| `EXPIRED_NO_SHOW`, buyer at fault | buyer: price · seller: 80% of buyer's deposit · platform: 20% recovery fee | released |
| `EXPIRED_NO_SHOW`, seller at fault | buyer: price + deposit + 80% of seller's deposit · platform: 20% recovery fee | **captured**, routed to buyer minus recovery fee |
| Dispute **split** (no fault) | price 50/50 (odd cent to seller) · buyer deposit back whole — no fees | released |

The "80% of deposit" to the stood-up party is **capped at $15** (deals ≥ ~$375); MeetMe keeps the 20% recovery fee plus anything above the cap. Dispute endings never capture the seller's deposit. If a capture fails on a real rail (empty/prepaid card), the company absorbs the payout via `platform:penalty` and the seller takes a −50 trust hit (`payments.ts` → `absorbFailedCollection`).

## packages/core

| File | Owns |
|---|---|
| `states.ts` | `DealState` union, terminal set, `ALLOWED_TRANSITIONS` graph |
| `machine.ts` | `createDeal` + `applyAction` — the one guarded, atomic transition function; all ledger builders |
| `money.ts` | fee tiers, `splitFee` (buyer capped at deposit − $1), `depositForAmount` (5%, $5–$25), `recoveryFeeForDeposit` (20%, comp capped at $15), $5 min deal, $500 phone-tier cap, `requiresKyc` |
| `ledger.ts` | account refs, balanced-entry helpers, `escrowHeld` (derived from state) |
| `geo.ts` | haversine distance, 60 m co-location radius, midpoint |
| `types.ts` | `Deal`, `Action`, `SideEffect`, `LedgerEntry`, `Ctx` (injected time/ids/codes — the machine is deterministic) |

## packages/server

- **`repo.ts`** — the persistence boundary (`Repo` interface): deals with optimistic versions, users, transfers, locations, push tokens, invites, KYC, card-on-file, chat, blocks/reports. Two implementations with identical semantics: `memoryRepo.ts` (tests) and `supabaseRepo.ts` (delegates `commit` to the `apply_transition` RPC so the whole write is one transaction).
- **`handler.ts`** — the one mutation entry point: load → **authorize** (who) → **applyAction** (when/what) → **commit** (atomic, version-locked). Nothing persists on any failure. Gates: `card_required` (seller must have a card on file to `ACCEPT_TERMS`). `createDealHandler` gates: no self-deals, integer cents, **$5 minimum**, terms accepted, **`kyc_required`** above $500 for unverified creators, counterparty exists, **`blocked`** (either direction).
- **`rails/`** — `rail.ts` (the `PaymentRail` interface + risk threshold 75), `fakeRail.ts` (deterministic test rail; card validation always passes with last4 `4242`; holds/captures in-memory), `plaidRail.ts` (scaffold).
- **`payments.ts`** — `executeAction` wraps the handler with rail execution: a Signal-style risk gate before funding; releases blocked until the buyer's funding has **settled**; payouts/refunds mirrored from the committed ledger's bank credits (the rail can never disagree with the accounting); seller-hold place/capture/release effects; collection-failure absorption.
- **`signup.ts`** — one account per phone, VoIP numbers rejected, terms accepted at signup, trust starts at 50.
- **`worker.ts`** — pure `dueTransition` + `runWorkerOnce` driver: syncs funding settlement, then fires timed system actions. Windows: **no-show after 30 min** (EN_ROUTE, one party arrived, measured from the deal's last write) and **auto-release after 60 min** (CONFIRMING). Driven every 15 s by `apps/api/src/worker.ts`.
- **`location.ts`** — stores each party's latest ping; fires system `CO_LOCATED` when both are within 60 m while EN_ROUTE; returns only distance + state.
- **`invites.ts`** — accept a pending invite → creates the real deal with the inviter on their chosen side (buyer or seller), the accepter on the other.
- **`geoapify.ts` / `staticMap.ts`** — safe-spot search (police = verified tier), geocoding, drive-time matrix, static map URL builder.
- **`notify.ts` / `pushExpo.ts`** — per-state push messages via Expo (no-op sender in tests).
- **`authToken.ts`** — Supabase JWT → `auth.uid()` verification for the API.

## apps/api — HTTP surface

Fastify (`server.ts`), injectable deps for tests. Auth: `Bearer <supabase-jwt>` or, when `allowDev`, `Bearer dev:<userId>`. All routes require auth except `POST /signup`.

| Route | Does |
|---|---|
| `POST /signup` | mint a profile (demo mode uses this; real users come from Supabase Auth) — no auth |
| `POST /deals` | create a deal by counterparty id or phone (kyc/blocked/min-deal gates) |
| `GET /deals` | the caller's deals |
| `GET /deals/:id` | deal detail + transfers + names/trust + static-map URL — participants only |
| `POST /deals/:id/actions` | apply a state-machine action (`executeAction`); returns the release code to the buyer at `REVEAL_CODE` |
| `DELETE /deals/:id` | delete a DRAFT (active deals must CANCEL) — participants only |
| `GET /deals/:id/messages` | chat history — participants only |
| `POST /deals/:id/messages` | send a message (blocked pairs are muted; best-effort push) — participants only |
| `POST /deals/:id/location` | location ping → distance-between + co-location detection — participants only |
| `GET /deals/:id/meetup-suggestions` | fair meetup spots ranked by balanced drive time — participants only |
| `GET /geocode` | address → point (needs `GEOAPIFY_KEY`) |
| `POST /invites` | invite by phone as buyer or seller (kyc/blocked/min-deal gates; push if invitee registered) |
| `GET /invites` | pending invites addressed to the caller's phone |
| `GET /invites/:token` | invite detail |
| `POST /invites/:token/accept` | accept → creates the deal |
| `POST /invites/:token/decline` | decline (invitee) or rescind (inviter) |
| `POST /payment-method` | add a card on file ($0 validation — FakeRail stub) |
| `POST /kyc/verify` | mock ID verification — bumps the tier |
| `GET /users/:id/profile` | public reputation card (no PII) + shared deal history; card fields self-only |
| `POST /users/:id/block` | block a user (mutual gating) |
| `DELETE /users/:id/block` | remove the caller's own block |
| `GET /blocks` | who the caller has blocked |
| `POST /users/:id/report` | file a confidential report (reason capped at 300 chars) |
| `POST /profile` | sync the caller's display name |
| `POST /push-token` | register this device's Expo push token |
| `POST /dev/deals/:id/settle-funding` | dev: mark funding settled |
| `POST /dev/deals/:id/return-funding` | dev: mark funding returned |
| `POST /dev/deals/:id/resolve` | dev: stand-in admin console — `RESOLVE_DISPUTE` as admin |

28 routes: 25 app-facing + 3 `dev/*` (mounted only with `allowDev`).

## apps/app — Expo / React Native

**Navigation** (`App.tsx`): `ThemeProvider` → `AppProvider` → auth switch — no session and no demo shows a bare Login stack; otherwise bottom tabs:

```
Tabs ── DealsTab ── DealsStack: Home → Deal
    └── AccountTab ── Account
```

**State architecture** — `src/app/AppContext.tsx` holds *all* app state and handlers (one provider, lifted from the old single-component root); screens are thin views over `useApp()`. `src/app/dealLogic.ts` holds pure helpers (next-action derivation, labels, formatting, fee split mirror). Data freshness:

- **Real login** — Supabase phone-OTP session; the Deal screen subscribes to Supabase Realtime `postgres_changes` on `deals` / `transfers` / `messages`. **`supabase.realtime.setAuth(token)` is required after login** so the socket runs as the user — without it, RLS-gated changes silently never arrive. The Home screen polls (4 s, focus-gated) because invites are server-only rows Realtime can't deliver.
- **Demo mode** — no Supabase session, so both screens poll on focus (Home 4 s, Deal 2.5 s).

**Theme system** (`src/theme/`): `types.ts` is the token contract — colors by role, 4pt spacing, radius, type scale, shadows, and **motion tokens** (durations, spring params, easing beziers). Two complete themes fill the same slots: `polish` (green, default) and `fintech` ("Trust", blue), both light-mode. `useTheme()` everywhere means swapping the active theme re-skins the whole app; `ThemeToggle` (a dev affordance on the Account screen) flips them live, persisted in AsyncStorage.

**UI kit** (`src/ui/` — presentational, theme-driven): Button · Badge + StatusPill · Avatar + AvatarPair · Card + SectionLabel · TrustBanner · Stepper · PresenceCard · DealCard · MeetupField · DealHistoryRow · Callout · WalletSplit · Accordion · RatingStars, plus `UIGallery` — set `SHOW_UI_GALLERY = true` in `App.tsx` to render the kit instead of the app for design review.

**Animation layer**: Reanimated `entering`/`exiting` (staggered `FadeInDown` section entrances, crossfades keyed on deal state, `ZoomIn` accents) driven by the theme's motion tokens; `useReducedMotion` falls back to plain fades; Moti powers kit micro-animations (Accordion, Presence, Rating); sheets use a custom Reanimated `SpringSheet` (in `src/app/components.tsx`). Haptics map (`AppContext.actionHaptic`): FUND / HEAD_OUT / ARRIVE → medium impact; ENTER_CODE / CONFIRM_RECEIVED → success; OPEN_DISPUTE (and leave-safely) → warning; RATE → selection.

**Demo mode mechanics**: "Try the demo" mints two users via `POST /signup` (Maya Chen + Sam Rivera, unique `+1555…` numbers), authenticates them with `dev:<userId>` bearer tokens, and a "Viewing as" toggle switches which side the device drives. A dev convenience, not a feature.

## db

`db/migrations/` is the canonical numbered set; `supabase/migrations/` mirrors the same files with timestamped names so the Supabase CLI (`db:start` / `db:reset`) applies them.

| # | What |
|---|---|
| 0001 | schema — users, deals, events, ledger, transfers; money as bigint cents; server-generated IDs |
| 0002 | RLS — clients read only rows they're party to, never counterparty private data, never write money tables |
| 0003 | ledger guard — deferred trigger: the DB refuses unbalanced ledger txns at COMMIT |
| 0004 | `apply_transition` RPC — the atomic commit (version check + deal + events + ledger + effects) |
| 0005 | grants — table privileges; functions restricted to `service_role` |
| 0006 | `deal_locations` — latest ping per (deal, user); server-only, no client policies |
| 0007 | realtime — deals / transfers / deal_events added to the `supabase_realtime` publication (RLS-scoped) |
| 0008 | auth ↔ profile — mirror `auth.users` into `public.users` so `auth.uid()` = `users.id` |
| 0009 | headed-out — per-party head-out timestamps stamped by `apply_transition` |
| 0010 | invites — invite-by-phone table; server-only |
| 0011 | dispute persistence — disputes + dispute_positions written via transition side-effects |
| 0012 | dispute proposals — self-service resolution proposals; auto-resolve on match |
| 0013 | meetup spot — agreed spot fields on the deal |
| 0014 | messages — in-deal chat; participant read via RLS/Realtime, sends via server |
| 0015 | blocks + reports — safety tables; server-only |
| 0016 | card commitment — card-on-file seller flow; seller stake removed (FUND arms directly) |

**RLS posture:** all writes go through the server using `service_role` (bypasses RLS); client policies are read-only and participant-scoped, which is also what makes Realtime deliveries safe. Location, invite, block, and report tables have *no* client policies at all.

## Dev / verification tooling

- **UI verification loop**: iOS simulator + `idb` (tap / screenshot) to drive and eyeball flows; the UI Gallery flag for component review.
- **Local OTP**: test numbers `+15551230001…04` with fixed code `123456` (`supabase/config.toml`) — they never hit Twilio.
- **The API has no watch mode** — `npm run api:dev` runs plain `tsx`; restart it after backend changes.
- `npm test` (95 unit/integration tests on MemoryRepo + injected Fastify), `npm run smoke` (a real deal through live local Postgres), `npm run typecheck`.

## Environment / config

Server (`.env`, names only — see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS — never ship to a client), `GEOAPIFY_KEY` (server-only), `PORT` (default 8787), `WORKER_INTERVAL_MS` (default 15000).

App (Expo public vars, safe for clients): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (defaults to the well-known local-dev anon key). `apps/app/start-phone.sh` (`npm run phone`) sets the first two to your Mac's LAN IP for physical-device testing.

## Known limitations

Everything faked, stubbed, or deferred is tracked in [`PLACEHOLDERS.md`](PLACEHOLDERS.md) — FakeRail money, mocked KYC, Expo-Go push limits, static (non-interactive) maps, the dev-endpoint admin console, and more.
