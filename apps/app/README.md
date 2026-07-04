# MeetMe app (Expo / React Native)

The tap-through UI. It is a thin client: it holds no rules and no money logic —
every decision happens server-side in `@meetme/api`. Two ways in:

- **Sign in with phone** (real Supabase Auth OTP) — one identity per device, live
  updates over Supabase Realtime, push notifications. Locally, use a demo number
  (`+15551230001` … `+15551230004`) and code **123456** — no SMS is sent.
- **Demo mode** — one device drives BOTH parties via a "Viewing as" toggle (dev
  login, polling). Handy for testing the whole loop without two phones.

## Run it

1. **Start the backend** (from the repo root, in another terminal):
   ```bash
   npm run db:start      # local Supabase (Docker)
   npm run api:dev       # API on http://localhost:8787
   ```
2. **Start the app** (from this folder):
   ```bash
   cd apps/app
   npm install
   npx expo start
   ```
   Press `i` for the iOS simulator, `a` for Android, or scan the QR with Expo Go.

## Pointing the app at the backend

Everything runs **on your Mac** (Supabase + API + Metro); the phone just connects
over the **local network** — no internet needed (money is FakeRail, auth/DB are
local). The only requirement: **phone and Mac on the same network**.

**Easiest — one command (any network, home or a hotspot in the car):**
```bash
cd apps/app && npm run phone
```
`npm run phone` auto-detects your Mac's **current** LAN IP (it changes per network!)
and launches Expo Go pointed at it. On the road: turn on your **iPhone Personal
Hotspot**, connect the Mac to it, then run `npm run phone`.

**Manual** (if you want to set it yourself): the app reads `EXPO_PUBLIC_API_URL`
(default `http://localhost:8787`, fine for the iOS simulator) and
`EXPO_PUBLIC_SUPABASE_URL` (default `http://localhost:54321`). For a physical device
set both to `http://<mac-LAN-ip>:{8787,54321}` — find the IP with
`ipconfig getifaddr en0`. (The local Supabase anon key is baked in; override with
`EXPO_PUBLIC_SUPABASE_ANON_KEY` for hosted.)

## The flow

**Real login:** enter a name + a demo number (`+15551230001`), tap **Send code**,
enter **123456**, **Verify**. Fill in the **item + price**, the counterparty's
phone (`+15551230002`), and whether **you're buying or selling**, then **Send
invite**. They see it under **Invites for you** (told which side they'll take) and
tap **Accept** to create the shared deal. You can also fire off a skippable SMS
heads-up. Advance your side; the other phone sees it live via Realtime, including a
per-party **heading over / arrived** status in EN_ROUTE. Swipe a **draft** deal
left to **delete** it.

**Demo mode (one phone, no login):** tap **Demo mode**, then **Viewing as** to
switch sides:
Sam accepts → Maya funds → Sam posts stake → both head out → **Share my location**
on each side (geofence auto-arrives you both) → Maya reveals the code → Sam enters
it → Maya confirms → **RELEASED**. A **banner** flashes on each state change; the
open deal polls every 2.5s.

The **Money** section shows live transfers (funding, payout, refunds) from the ledger.

## Notes / scaffold caveats

- This folder is **excluded from the root npm workspaces** on purpose — the React
  Native toolchain shouldn't be pulled into the backend install. Install deps here
  separately (`cd apps/app && npm install`).
- Targets **Expo SDK 54** (React Native 0.81, React 19) so it runs in the current
  Expo Go on your phone. Deps are installed and verified here — `npx expo-doctor`
  passes all 18 checks. If you ever change SDK, run `npx expo install --fix` to
  realign the pinned versions.
- **Location** needs the OS permission prompt (config in `app.json`). On one phone
  both parties share the same GPS, so sharing location as each side co-locates them
  instantly — great for a single-device demo; on two phones each shares its own.
- **Live updates:** real-login sessions use **Supabase Realtime** (RLS delivers only
  your deals); Demo mode has no session so it falls back to **polling** (2.5s).
- **Push** needs a **dev build** — Expo Go on SDK 54 can't receive remote push. The
  app registers a token and the server sends via Expo's push API, but to actually
  get notifications on-device, build a dev client:
  ```bash
  npx expo install expo-dev-client
  npx eas build --profile development --platform ios   # (needs a free Expo/EAS account)
  ```
  Until then, the in-app banners still cover state changes.
- The release code is minted at **reveal** and shown to the **buyer only** (the
  seller learns it in person) — only the hash is ever stored.
