# Placeholders & demo shortcuts — things to come back to

Running list of anything faked, stubbed, or deferred for the demo/MVP. Update this
whenever we take a shortcut. (Also mirrored in project memory.)

## Money (biggest one)
- **FakeRail only** — all money movement is simulated in-code (funding, RTP-instant
  settle, payout, refund). No real Plaid/Stripe. `PlaidRail` is a scaffold.
- **Card on file / seller commitment is a FakeRail stub** — `POST /payment-method`
  "validates" a card ($0 auth) and always returns last4 `4242`; the hold placed at
  the seller's head-out, the capture on a no-show, and the release on completion are
  all in-memory. Real rail: **Stripe SetupIntent** (save the card) + a
  **manual-capture PaymentIntent** (the hold). Real-rails considerations: card auth
  holds **expire after ~7 days** (re-auth or place the hold closer to the meetup),
  captures can be disputed/charged back, and a failed collection currently means the
  company absorbs + a trust nuke (an account **ban** on collection failure is deferred).
- **Money stays test-mode** until a fintech/MSB attorney signs off (never custody
  funds directly; use a licensed partner). Real rails = a later milestone.

## Auth / identity
- **Local test-OTP**: numbers `+15551230001…04`, fixed code `123456`. Twilio is
  enabled in `config.toml` with **placeholder credentials** only so GoTrue accepts
  sends — test numbers never actually call Twilio.
- **Real SMS (Twilio)** for OTP is a hosted concern — not wired.
- **No KYC step-up** yet (phone tier only; ID-verification-for-higher-limits deferred).
- **Demo mode** (Maya & Sam on one device, `dev:<userId>` tokens) is a dev
  convenience, not a real feature.

## Notifications
- **Push**: `expo-notifications` + server-side Expo send are wired and token
  registration works, but **on-device receipt needs a dev build** (Expo Go/SDK 54
  can't). In-app banners cover state changes meanwhile.

## Realtime
- **Real-login** sessions get true Supabase Realtime — deals, transfers, and **chat**
  deliver live. (Required `supabase.realtime.setAuth(token)` after login so the socket
  runs as the user, not anon — without it RLS-gated changes silently never arrive.)
- **Demo mode** falls back to polling (2.5s) since dev-login has no Supabase session.

## Invites
- Delivery is an **in-app inbox** (keyed to the invitee's phone) + a **skippable
  native SMS composer** (`sms:` link). **No real deep link / web landing page** and
  **no server-sent SMS** yet — both are hosted concerns.

## Geofence / presence
- Single-device demo shares one GPS, so "share location" as each side co-locates
  instantly. Real two-device uses each phone's own GPS. Manual "I've arrived" stays
  as a fallback.
- Worker timers are **30 min** (no-show) / **60 min** (auto-release) — may want
  shorter for demos (`WorkerWindows`).

## UI
- **Map is a static image, not interactive** — the live map is a **Geoapify Static
  Maps** (OpenStreetMap, free tier) image the server builds from the real location
  pings; it refreshes but doesn't pan/zoom. Interactive (MapLibre / react-native-maps)
  needs a dev build. Key is server-side (`GEOAPIFY_KEY` in `.env`); positions show
  only during EN_ROUTE/AT_MEETUP, only to participants. The stylized card is the
  fallback until someone shares location.
- **Dispute resolution is a dev endpoint** — `POST /dev/deals/:id/resolve` stands in
  for the support/admin console (fires RESOLVE_DISPUTE as `admin`). Self-service
  resolution (both parties agree → auto-resolve) and a real admin console are
  deferred. Evidence attachments (photos) on statements also deferred.
- **Rating comments + history + profile screen** — M9 added star ratings + a
  reputation line on the deal; free-text comments, a rating history, and a real
  profile screen are still deferred.

## Fixed (no longer placeholders)
- ~~Hardcoded $300 / "iPhone 12"~~ — deals take item + price inputs (2026-07-02).
- ~~Release code shown to the seller~~ — minted at reveal, buyer-only.
- ~~Invites one-directional~~ — inviter chooses buyer or seller.
- ~~No input formatting/validation~~ — money is a `$_____.__` currency mask (exact,
  the button never rounds to whole dollars); phone is a `___-___-____` mask →
  E.164 on submit; create/invite buttons disable until item + amount (+ valid
  phone) are present.
- ~~No trust signals~~ — escrow trust banner + "how your money stays safe"
  explainer on the deal screen (2026-07-02, M7).
- ~~No live presence UI~~ — live map-look card with both avatars + status (M7);
  a *real* map now renders too (Geoapify/OSM static image during a meetup) — only
  interactive pan/zoom is still deferred (see above). **Planned: MapLibre** for the
  interactive version (bundle with the push dev-build; reuse the Geoapify key for
  tiles) — see project backlog.
- ~~Stale profile name (set once at first sign-in)~~ — the app now syncs the name
  via `POST /profile` on every login, so the counterparty sees your current name.
- ~~Invites needed a manual reload~~ — the home screen polls (4s) for new invites +
  deal updates. (Invites can't use RLS-gated Realtime, so polling; see Realtime note.)
- ~~No disputes flow~~ — open dispute → both statements (persisted) → support
  resolution (release/refund/split), with UI (M8). Admin console is still the dev
  endpoint (above).
- ~~Transfer direction mislabeled on splits~~ — direction now follows the recipient
  (seller = payout, buyer = refund) across release/split/no-show/cancel.
- ~~No ratings~~ — star ratings after a completed deal + a counterparty reputation
  line (trust score / deal count) on the deal screen (M9).
- ~~Can't back out / cancel~~ — Cancel/back-out on the deal screen: **free full
  refund before heading out; forfeit your commitment after** (self-declared no-show).
  See `docs/deal-rules.md`.
- ~~Can't decline an invite~~ — Decline button on invite cards (invitee dismisses;
  inviter can rescind).
- ~~No dispute self-resolution~~ — both parties can propose an outcome; matching
  proposals auto-resolve by agreement (no admin). Admin/dev endpoint remains the
  fallback.

## Safety layer (in progress)
- **Meetup spot** ✅ — fair-by-time midpoint finder (Geoapify Places near the midpoint,
  ranked by balanced drive time via Route Matrix; police = "verified" tier) + custom
  spot with a warning. Shown on the map as an amber pin.
- **Arrival still uses co-location, not proximity to the spot** — the geofence marks
  "both arrived" when the two phones come together (anywhere), not specifically at the
  chosen spot. Good enough for now; verifying arrival *at the meetup spot* is a refinement.
- **Chat** ✅ — in-deal text chat once a deal is accepted (AGREED onward), via a
  `messages` table + RLS + Realtime; sends go through the API (best-effort push to the
  other party). Text-only; images/moderation deferred.
- **Report / block a user** ✅ — Report (scam / no-show / harassment / prohibited item)
  and Block a counterparty from the deal screen. Blocks are mutual and permanent:
  `isBlocked` (either direction) gates both `createDeal` and `/invites`. Backed by
  `blocks` + `reports` tables (migration 0015), server-only via `service_role`.
  Reports are **stored for review but there's no admin/moderation console yet** —
  reviewing/actioning reports is deferred.
- **Panic / discreet abort** ✅ — "Feel unsafe? Leave safely" on active meetup states
  (ARMED→CONFIRMING): call 911 (`tel:`), or **Leave & report** (files a `safety` report,
  then backs out before the meetup or **freezes funds via a dispute** once at the meetup,
  and returns home in one tap). No fake-call/decoy screen yet.
- **Counterparty profile** ✅ — tap the reputation line on a deal to see the other
  party's public card: avatar, name, phone/ID-verified badge, member-since, trust-score
  bar, completed-deal count, and **your shared deal history** with them, plus a
  report/block shortcut. `GET /users/:id/profile` returns no PII (no phone).
  Rating *comments* (free-text reviews) are still deferred — only the numeric trust
  score + deal outcomes are shown.

## Still stubbed
- **KYC verify is mocked** — `POST /kyc/verify` just bumps the tier; a real licensed
  KYC partner does ID verification for real. Threshold ($500) is tunable.

> Note: US-only phone format (`+1`) for now — international numbers are a later concern.
