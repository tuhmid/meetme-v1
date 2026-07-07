# MeetMe

A P2P **escrow + safe-meetup** trust layer for in-person exchanges between strangers: the buyer's money sits in escrow, both parties are guided to a safe meetup spot, and funds release only on a code-confirmed handoff. **All money is simulated (FakeRail test-mode)** — no real funds move, and none will until a licensed money partner and a fintech attorney sign off.

## What it does

**The deal loop** — a 4-step flow on top of a server-side state machine:

1. **Agree** — either party creates a deal (or invites the other by phone); the seller accepts the terms.
2. **Fund** — the buyer escrows the price + a $5 deposit, which arms the deal.
3. **Meet** — both head out, tracked live; a geofence detects when the phones come together.
4. **Release** — the buyer reveals a one-time code, the seller enters it, the buyer confirms, and escrow pays out.

**Money model** (full rules in [`docs/deal-rules.md`](docs/deal-rules.md)):

- **Flat $5 show-up deposit per side**, every deal size. The buyer's rides along in escrow; the seller's is a card hold placed when they head out. A forfeited deposit goes to the stood-up party — never to the platform.
- **One total fee per deal, charged only on completion**, tiered by price:

  | Price | Total fee |
  |---|---|
  | ≤ $40 | $5 |
  | ≤ $80 | $7 |
  | ≤ $120 | $9 |
  | ≤ $200 | $10 |
  | ≤ $300 | $12 |
  | ≤ $500 | $15 |
  | > $500 | 5% of price, capped at $50 |

  Split between the sides: the buyer pays half, **capped at $4** (so a completing buyer always gets at least $1 of their deposit back); the seller pays the rest.
- **Minimum deal $5.** Deals over **$500** require the creator to be ID-verified (KYC step is mocked for now).
- Back out **before** anyone heads out: free, full refund. **After** heading out: you forfeit your $5 deposit to the other party. No-shows are detected automatically by a background worker.

**Seller card-on-file** — sellers never escrow money. A card ($0 validation) is required to accept a deal; a $5 authorization hold is placed when the seller heads out, captured only if they no-show or back out, released untouched on completion. (Stubbed on FakeRail; the real rail is Stripe SetupIntent + manual-capture PaymentIntent.)

**Safety features:**

- **Meetup midpoint finder** — safe spots (police stations = "verified" tier, then transit hubs, malls, banks) near the geographic midpoint, ranked by *balanced* drive time for both parties (Geoapify Places + Route Matrix). Custom spots allowed with a warning.
- **Live presence + map** — per-party "headed out / arrived" status, plus a real OpenStreetMap image (Geoapify Static Maps, built server-side from live pings) during the meetup. Raw coordinates are never shown to the other party — only distance-between.
- **In-deal chat** — text chat from acceptance onward (Supabase Realtime for logged-in users; sends go through the API with best-effort push).
- **Disputes** — either party freezes the funds; both submit statements; matching proposals **auto-resolve by agreement** (release / refund / split), otherwise support decides (currently a dev endpoint).
- **Report / block / unblock** — report a counterparty (scam, no-show, harassment, prohibited item); blocks are mutual and gate new deals, invites, and chat.
- **Panic "leave safely"** — a discreet affordance on active meetups: call 911, or leave-and-report in one tap (backs out before the meetup; freezes funds via a dispute once there).

**Also in the app:**

- **Trust scores + ratings** — star ratings after completed deals accrue to a 0–100 trust score; a counterparty reputation line and tappable public profile (no PII) on every deal.
- **Invites by phone** — invite someone who isn't on MeetMe yet, as buyer or seller; they see it in-app on sign-in and can accept or decline.
- **Account screen** — your profile, card on file, ID verification, blocked-users list, sign out.
- **Two switchable themes** — "Polish" (green) and "Trust" (fintech blue) share one token contract; an on-device toggle flips them live (a dev affordance until a direction is chosen).
- **Motion + haptics** — Reanimated staggered entrances and state crossfades (with reduced-motion fallbacks), spring sheets, and a per-action haptic map.

## Monorepo map

```
packages/core      @meetme/core — pure domain: state machine, money, double-entry ledger, geo
packages/server    @meetme/server — handler, authz, payments/rails, repos, worker, invites, safety
apps/api           Fastify HTTP API + background worker entrypoints
apps/app           Expo / React Native app (screens, UI kit, themes)
db/migrations      canonical numbered SQL migrations (0001–0016)
supabase           Supabase CLI project — config + timestamped mirror of db/migrations
docs               deal rules, architecture, placeholders, milestone plans
```

## Getting started

Backend (needs Docker for local Supabase):

```bash
npm install
npm run db:start     # local Supabase (Postgres + Auth + Realtime + Studio) + migrations
npm run api:dev      # API on http://localhost:8787 (no watch mode — restart after changes)
npm run worker:dev   # optional, another terminal: no-show / auto-release timers
```

App (separate install — `apps/app` is outside the root workspaces):

```bash
cd apps/app && npm install
npx expo start       # simulator
npm run phone        # physical device: points Expo + the app at your Mac's LAN IP
```

**Try the demo** — tap "Try the demo" on the login screen: one device drives both parties (Maya & Sam) via a "Viewing as" toggle. No second phone needed.

**Real sign-in (local)** — phone OTP against local Supabase using the test numbers `+15551230001…04`, code `123456` (no SMS is sent).

## Testing

```bash
npm test             # 95 tests — machine, money conservation, handler, payments, worker, API
npm run smoke        # one real deal through live local Postgres (needs db:start + .env)
npm run typecheck    # core + server + api
```

## Docs

- [`docs/deal-rules.md`](docs/deal-rules.md) — the money model: fees, deposits, every outcome
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the system on one page
- [`docs/PLACEHOLDERS.md`](docs/PLACEHOLDERS.md) — everything faked, stubbed, or deferred

## Status

v1, in active development. The full deal loop — signup through release, disputes, no-shows, ratings — runs end-to-end against local Supabase. **All money movement is simulated**: FakeRail stands in for real payment rails until a licensed partner and fintech-attorney sign-off. Nothing here moves real money.
