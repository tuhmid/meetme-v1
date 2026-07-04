# M7 — Trust + live-map UI pass

The screen from the mockup. Goal: make strangers *trust* handing over money, and
show the meetup coming together live. Frontend-only — the data (escrow state,
presence, co-location distance) already existed from M2/M4/M6.

## What M7 adds

### 1. Escrow trust signal
- A **trust banner** on every deal screen (`shield-checkmark` icon, green): reads
  the situation — before funding "Funds are held safely in escrow until handoff",
  after funding "Your $220.00 is safe in escrow" (buyer) / "The buyer's $220.00 is
  secured in escrow" (seller).
- Tapping it opens a **"How your money stays safe" explainer** (bottom sheet):
  held in escrow → released only on handoff (release code) → no-show protection →
  refundable. This is the reassurance you asked for.

### 2. Live presence map card
- A stylized **map-look card** on the deal screen (EN_ROUTE / AT_MEETUP): a
  "Meetup" header with a **LIVE** indicator, a dashed route line toward the
  destination pin, and **both parties' avatars** (colored initials) positioned by
  status — *not left → heading over → arrived*. The current user's avatar shows
  `{distance}m · you`; the other shows their status. Exactly the mockup shape.
- Avatars use real initials — the deal-detail endpoint now returns `buyerName` /
  `sellerName` (from the profiles).
- It's a **stylized presence view**, not a real geographic map (react-native-maps
  + a maps key is a later option); the positions are driven by real presence data.

### 3. Icons + exact money everywhere
- Added `@expo/vector-icons` (Ionicons) — no emoji. (`expo-font` peer pinned to
  SDK 54; doctor clean.)
- Every amount now renders via `formatMoney` (exact `$220.00`) — the deal header,
  home list, and invite inbox no longer round to whole dollars.

## Server change
`GET /deals/:id` now includes `buyerName` / `sellerName` (looked up from profiles)
so the map can show real initials. Additive; covered by the API test.

## How it was verified
- `npm test` — **51 pass** (added a `buyerName`/`sellerName` assertion to the
  full-deal HTTP test).
- App **typechecks + bundles**, `expo-doctor` **18/18** (after pinning `expo-font`).
- Backend typecheck + live smoke green.

## Still deferred (see `docs/PLACEHOLDERS.md`)
- **Real geographic map** (react-native-maps) — the card is a stylized stand-in.
- Disputes UI + resolution; ratings UI; KYC step-up; hosted SMS/push; real invite
  deep-links. Money stays test-mode until attorney sign-off.
