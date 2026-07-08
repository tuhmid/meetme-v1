# Chat images — design

Date: 2026-07-07
Status: approved → implementing

## Problem

In-deal chat is text-only. Participants often need to send a photo ("here's the item",
"I'm the one in the blue jacket", a receipt) to coordinate a safe handoff.

## Design

- **Storage:** a private Supabase Storage bucket `deal-media`. Uploads go through the API
  (service_role) — one code path for both demo (dev token) and real-login mode, matching
  how text sends already work ("sends go through the API"). Images are served via
  short-lived **signed URLs** minted server-side on message list (private bucket — handoff
  photos can be identifying, so no public URLs).
- **Schema (migration 0019):** `messages.image_path text` (nullable); `body` becomes
  nullable; a check constraint enforces `body is not null OR image_path is not null`.
- **Upload flow:** attach button → `expo-image-picker` (compressed `quality: 0.5`,
  `base64: true`) → `POST /deals/:id/messages` with `{ body?, imageBase64?, contentType? }`
  → API decodes, uploads to `deal-media/<dealId>/<uuid>.<ext>`, stores the path on the
  message. Fastify `bodyLimit` raised (~12 MB) for the image payload.
- **List:** `GET /deals/:id/messages` returns each message with `imageUrl` — a signed URL
  (~1 h TTL) generated from `image_path`, or null.
- **Render:** an image message shows the photo inline (capped width, aspect-preserving)
  with the optional text caption beneath.

## Components

- **Migration 0019** (`db/migrations` + supabase mirror): column + check + bucket insert.
- **Repo** (`repo.ts` / `supabaseRepo.ts` / `memoryRepo.ts`):
  - `addMessage(dealId, senderId, body: string | null, imagePath?: string | null)`
  - `listMessages` returns `{ senderId, body, imagePath, createdAt }`
  - `putDealImage(dealId, bytes: Uint8Array, contentType): Promise<string>` (returns path)
  - `signImageUrl(path): Promise<string | null>`
  - MemoryRepo: in-memory stubs (data-URI passthrough) so unit tests don't need Storage.
- **Server** (`server.ts`): `POST /deals/:id/messages` accepts an optional image; `GET`
  attaches signed `imageUrl`. `bodyLimit` bump in `buildServer`.
- **App:**
  - `expo-image-picker` + config plugin (photo-library permission).
  - `api.sendMessage(auth, id, body, image?)`; a `Message` type with `imageUrl`.
  - `AppContext.attachImage()` — pick, compress, send.
  - `DealScreen` — an image/attach button in the chat input row; render image bubbles.

## Testing

- **server.test**: a message with an image round-trips (send with imageBase64 → list shows
  a message with a non-null image reference); text-only still works; non-participant
  blocked. (MemoryRepo backs these — no live Storage.)
- **app typecheck** + **live smoke** unchanged.
- Device pass (can't automate): pick an image, see it upload + render both sides.

## Non-goals

- Video / multiple attachments per message.
- Full-screen image viewer / zoom (inline render only for now).
- Client-direct Storage upload (kept server-proxied for the single demo+real path).
