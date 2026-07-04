# M4 — Real identity, presence, and live updates

**Goal:** turn the single-device skeleton toward two real phones — real auth
plumbing, server-authoritative geofence arrival, live updates, in-app alerts, and
the release-code delivered to the buyer only. Scope choices (yours): **JWT
plumbing while keeping dev-login**, and **in-app alerts now, real push in M5**.

## What M4 adds

### 1. Auth — real JWT verification (dev-login stays)
`buildServer` now resolves the caller two ways: a real **Supabase access token**
(`Bearer <jwt>` → `verifyToken` → `auth.uid()`) **or** the demo shortcut
`Bearer dev:<userId>` (only when `allowDev`). `makeSupabaseTokenVerifier(url, anon)`
does the real verification via `auth.getUser`. So the production auth path is wired
and tested; the phone-OTP login screen is the remaining piece (a later pass).

### 2. Geofence — server-authoritative co-location
New pure `@meetme/core` geo helpers (`haversineMeters`, `withinRadius`,
`COLOCATION_RADIUS_M = 60`) and a system-only **`CO_LOCATED`** action that marks
**both** parties present atomically (EN_ROUTE → AT_MEETUP). A participant reports
location to `POST /deals/:id/location`; the server stores the latest ping
(`deal_locations`), computes the distance between the two, and fires `CO_LOCATED`
when they come together — "when their locations come together, mark them both
arrived." Manual "I've arrived" stays as a fallback. **Privacy:** the other
party's raw coordinates are never returned or client-readable (RLS: no policy on
`deal_locations`); the API returns only the distance-between and the new state.

### 3. Live updates
Supabase Realtime publication now streams `deals`, `transfers`, `deal_events`
(verified in `pg_publication_tables`). RLS already scopes these to the two
parties, so a subscriber only gets rows it may see.

> **Honest note:** the app currently uses **dev-login**, which has no Supabase
> session, so RLS-gated Realtime `postgres_changes` can't deliver to an anonymous
> client (and the service-role key must never ship in the app). So the app gets
> live updates via **polling** (2.5s) for now — works under dev-login and across
> devices. The Realtime infra is server-side and ready to switch on the moment
> real Supabase-Auth sessions land (M5).

### 4. In-app alerts
The app flashes a banner whenever the deal moves to a new state (driven off the
poll). Real remote push (`expo-notifications` + a dev build) is M5.

### 5. Release code → buyer only (the carryover fix)
The code is no longer minted at `POST_STAKE` (a seller action). It's minted at
**`REVEAL_CODE`** (a buyer action) and the plaintext is returned to the **buyer
only**; the server still stores just the hash. The seller learns it in person —
which is exactly what proves the handoff happened.

## New / changed surfaces
- core: `geo.ts`; `CO_LOCATED` action; code minting moved to `REVEAL_CODE`.
- server: `location.ts` (`submitLocation`), `authToken.ts` (`makeSupabaseTokenVerifier`),
  `Repo.upsertLocation/getLocations`, authz allows system `CO_LOCATED`.
- api: `resolveCaller` (JWT | dev), `POST /deals/:id/location`, `verifyToken` dep.
- db: `0006_deal_locations.sql` (RLS-locked), `0007_realtime.sql` (publication).
- app: `expo-location` geofence share, poll-based live sync, state banner.

## How it was verified
- `npm test` — **36 pass** (new: geo math, `CO_LOCATED`, buyer-only code delivery,
  server co-location + non-participant reject, HTTP JWT-auth path, HTTP geofence).
- `npm run smoke` — a real deal runs DRAFT→RELEASED against live Postgres now
  **via geofence co-location** (`deal_locations` + `CO_LOCATED`) + buyer-only code.
- Realtime publication confirmed via `pg_publication_tables`.
- App: typechecks clean, `expo-doctor` 18/18, full Metro bundle succeeds.

## Deliberately deferred (→ M5+)
- Phone-OTP **login screen** + real SMS provider (Twilio) for hosted.
- **Real remote push** (expo-notifications + dev build).
- Switching the app from polling to **true Realtime** once real auth sessions exist.
- Background **worker** (no-show/confirm-window timers, funding-settlement polling).
