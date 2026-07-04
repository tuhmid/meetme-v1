# M6 — Presence, invites, and draft cleanup

Functionality/MVP work from your asks: (1) see the other person's status live, (2)
invite someone by phone with a shareable/SMS nudge and an in-app inbox, (3) delete
draft deals with a swipe.

## What M6 adds

### 1. Live presence ("who's heading over")
The deal now tracks per-party **headed-out** (alongside arrived). `HEAD_OUT` flags
the actor and — for the second party — just flips their flag (no state change).
Migration `0009` adds `buyer_headed_out_at` / `seller_headed_out_at` and teaches
`apply_transition` to stamp them. In EN_ROUTE the deal screen shows both sides'
status — **not left yet → heading over → arrived** — so when one taps "I'm heading
out," the other's phone reflects it (Realtime in real mode, polling in demo).

### 2. Invites (add someone by phone)
- `invites` table (migration `0010`, server-only). `POST /invites {counterpartyPhone,
  itemDescription, amountCents}` creates a pending invite keyed to the invitee's
  phone and returns a token; best-effort push if they're already registered.
- The invite shows up in the invitee's **in-app inbox** (`GET /invites`, keyed to
  their phone) the moment they sign in — no deep link required.
- `POST /invites/:token/accept` creates the real deal (inviter = buyer, accepter =
  seller) and notifies the inviter.
- The app also offers to **text a heads-up** via the native Messages composer
  (`sms:` link) — skippable, no Twilio. (Real SMS-send is a hosted concern.)

### 3. Delete draft deals
`DELETE /deals/:id` hard-deletes a **DRAFT** (no money/ledger yet); active deals
return 409 (cancel those instead). In the app, **swipe a draft left → Delete**
(react-native-gesture-handler `Swipeable`, wrapped in `GestureHandlerRootView`).

## Notable fix
The API client set `content-type: application/json` on every request; Fastify 5
rejects that with an **empty body**, which would have broken body-less `DELETE`
(and `accept`). The client now sends the content-type only when there's a body —
caught by the live integration test.

## How it was verified
- `npm test` — **50 pass** (new: HEAD_OUT presence; invites accept/reuse/self;
  HTTP delete draft vs 409; HTTP invite create → inbox → accept).
- **Live over HTTP:** invite → Sam's inbox → accept → shared deal (buyer Maya /
  seller Sam); delete DRAFT → 404 gone; delete AGREED → 409; head-out flags flip
  per party. `npm run smoke` green; app typechecks + bundles, doctor 18/18.

## Backlog (planned, not built)
- **Trust signals in the UI** — small "your $300 is safe in escrow" affordance that
  opens a "how it works / why it's safe" explainer. Deferred to the UI-refinement
  pass (functionality first). Tracked in project memory.
- Dispute UI + resolution, KYC step-up, richer trust/ratings (later milestones).
- Real deep-linking for invite links; real SMS/push in a hosted build.
