import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { midpoint, requiresKyc, usd, MIN_DEAL_CENTS, type Action } from '@meetme/core';
import {
  acceptInvite,
  createDealHandler,
  driveTimeMatrix,
  executeAction,
  findSafeSpots,
  geoapifyMapUrl,
  geocode,
  markFundingReturned,
  markFundingSettled,
  notifyDealState,
  NoopPushSender,
  signup,
  submitLocation,
  type PaymentRail,
  type PushSender,
  type Repo,
  type ServerCtx,
} from '@meetme/server';
import { sendTwilioSms, verifySendSmsHook } from './sms';

export interface ServerDeps {
  repo: Repo;
  rail: PaymentRail;
  makeCtx: () => ServerCtx;
  /** Verify a real Supabase access token -> userId (auth.uid()). Wired in prod; omit in unit tests. */
  verifyToken?: (jwt: string) => Promise<string | null>;
  /** Push provider. Defaults to a no-op (tests); prod wires the Expo sender. */
  push?: PushSender;
  /** Geoapify Static Maps key (server-only). When set, deal detail includes a live map URL. */
  mapsKey?: string;
  /** expose /dev/* simulation routes + the `dev:<userId>` bearer shortcut (local only). */
  allowDev?: boolean;
}

const BEARER = 'Bearer ';

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 14 * 1024 * 1024 }); // headroom for base64 image uploads
  const push = deps.push ?? NoopPushSender;

  // Keep the raw JSON bytes around too — the Supabase send-sms hook signs over the exact body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  // Auth: a real Supabase JWT (`Bearer <jwt>` -> verifyToken) OR, when allowDev,
  // the demo shortcut `Bearer dev:<userId>`. Same resolved userId either way.
  async function resolveCaller(req: FastifyRequest): Promise<string | null> {
    const h = req.headers.authorization;
    if (!h || !h.startsWith(BEARER)) return null;
    const token = h.slice(BEARER.length);
    if (token.startsWith('dev:')) return deps.allowDev ? token.slice('dev:'.length) : null;
    return deps.verifyToken ? deps.verifyToken(token) : null;
  }

  app.post('/signup', async (req, reply) => {
    const { phone, name, isVoip } = (req.body ?? {}) as { phone?: string; name?: string; isVoip?: boolean };
    if (!phone || !name) return reply.code(400).send({ error: 'phone and name required' });
    const r = await signup(deps.repo, { phone, name, isVoip: !!isVoip }, deps.makeCtx());
    if (!r.ok) return reply.code(400).send({ error: r.reason });
    return { userId: r.user.id, name: r.user.name };
  });

  // Supabase "Send SMS" auth hook: GoTrue posts { user:{phone}, sms:{otp} } here and we relay
  // the code through Twilio's direct Messages API (trial-friendly — no Messaging Service needed).
  app.post('/auth/hooks/send-sms', async (req, reply) => {
    const secret = process.env.SEND_SMS_HOOK_SECRET;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!secret || !accountSid || !authToken || !from) {
      return reply.code(500).send({ error: { http_code: 500, message: 'sms hook not configured' } });
    }
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? '';
    if (!verifySendSmsHook(secret, req.headers, rawBody)) {
      return reply.code(401).send({ error: { http_code: 401, message: 'invalid signature' } });
    }
    const { user, sms } = (req.body ?? {}) as { user?: { phone?: string }; sms?: { otp?: string } };
    const phone = user?.phone;
    const otp = sms?.otp;
    if (!phone || !otp) return reply.code(400).send({ error: { http_code: 400, message: 'missing phone or otp' } });
    const to = phone.startsWith('+') ? phone : `+${phone}`;
    try {
      await sendTwilioSms({ accountSid, authToken, from }, to, `Your MeetMe code is ${otp}`);
    } catch (err) {
      return reply.code(500).send({ error: { http_code: 500, message: `sms send failed: ${(err as Error).message}` } });
    }
    return {};
  });

  app.post('/deals', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const { counterpartyUserId, counterpartyPhone, itemDescription, amountCents, useCase } = (req.body ?? {}) as any;
    // Resolve the counterparty by phone when an id isn't given (real-auth flow).
    let counterparty = counterpartyUserId as string | undefined;
    if (!counterparty && typeof counterpartyPhone === 'string') {
      const digits = counterpartyPhone.replace(/[^\d]/g, '');
      const other = (await deps.repo.getUserByPhone(digits)) ?? (await deps.repo.getUserByPhone(counterpartyPhone));
      if (!other) return reply.code(404).send({ error: 'that phone is not on MeetMe yet — they need to sign in once first' });
      counterparty = other.id;
    }
    if (!counterparty) return reply.code(400).send({ error: 'counterpartyUserId or counterpartyPhone required' });
    const r = await createDealHandler(deps.repo, { creatorUserId: uid, counterpartyUserId: counterparty, itemDescription, amountCents, useCase }, deps.makeCtx());
    if (!r.ok) return reply.code(r.code === 'forbidden' ? 403 : 400).send({ error: r.reason, code: r.code });
    return { dealId: r.deal.id, deal: r.deal };
  });

  app.get('/deals', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    return { deals: await deps.repo.listDealsForUser(uid) };
  });

  app.get('/deals/:id', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const rec = await deps.repo.getDeal(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.deal.buyerId !== uid && rec.deal.sellerId !== uid) return reply.code(403).send({ error: 'not a participant' });
    const [buyer, seller] = await Promise.all([deps.repo.getUser(rec.deal.buyerId), deps.repo.getUser(rec.deal.sellerId)]);
    // Map: the meetup pin once a spot is set, plus both parties during an active meetup.
    let mapUrl: string | null = null;
    if (deps.mapsKey) {
      const points: { lat: number; lng: number; color: string }[] = [];
      if (rec.deal.meetupLat != null && rec.deal.meetupLng != null) points.push({ lat: rec.deal.meetupLat, lng: rec.deal.meetupLng, color: 'd68a00' }); // meetup pin (amber)
      if (rec.deal.state === 'EN_ROUTE' || rec.deal.state === 'AT_MEETUP') {
        const locs = await deps.repo.getLocations(id);
        for (const l of locs) points.push({ lat: l.lat, lng: l.lng, color: l.userId === rec.deal.buyerId ? '2f6f5e' : '3b6fe0' });
      }
      if (points.length) mapUrl = geoapifyMapUrl(points, deps.mapsKey);
    }
    return {
      deal: rec.deal,
      version: rec.version,
      transfers: await deps.repo.listTransfers(id),
      buyerName: buyer?.name ?? null,
      sellerName: seller?.name ?? null,
      buyerTrust: buyer?.trustScore ?? null,
      sellerTrust: seller?.trustScore ?? null,
      buyerDeals: buyer?.completedDeals ?? 0,
      sellerDeals: seller?.completedDeals ?? 0,
      mapUrl,
    };
  });

  app.post('/deals/:id/actions', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const action = (req.body as { action?: Action }).action;
    if (!action) return reply.code(400).send({ error: 'action required' });
    const r = await executeAction(deps.repo, deps.rail, { dealId: id, action, callerUserId: uid, channel: 'user' }, deps.makeCtx());
    if (!r.ok) return reply.code(r.code === 'card_required' ? 400 : 409).send({ error: r.reason, code: r.code });
    void notifyDealState(deps.repo, push, r.deal); // best-effort push to both parties
    // Only the deal + (for the actor) the release code go back — not the raw ledger.
    return r.secret ? { ok: true, deal: r.deal, secret: r.secret } : { ok: true, deal: r.deal };
  });

  // Delete a DRAFT deal (no money/ledger yet). Active deals must be CANCELled instead.
  app.delete('/deals/:id', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const rec = await deps.repo.getDeal(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.deal.buyerId !== uid && rec.deal.sellerId !== uid) return reply.code(403).send({ error: 'not a participant' });
    if (rec.deal.state !== 'DRAFT') return reply.code(409).send({ error: 'only draft deals can be deleted; cancel an active deal instead' });
    await deps.repo.deleteDeal(id);
    return { ok: true };
  });

  // --- invites (add someone by phone; they accept in-app) ---
  app.post('/invites', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const { counterpartyPhone, itemDescription, amountCents, role } = (req.body ?? {}) as any;
    if (!counterpartyPhone || !itemDescription) return reply.code(400).send({ error: 'counterpartyPhone and itemDescription required' });
    if (!Number.isInteger(amountCents) || amountCents <= 0) return reply.code(400).send({ error: 'amountCents must be a positive integer (cents)' });
    if (amountCents < MIN_DEAL_CENTS) return reply.code(400).send({ error: `Deals start at ${usd(MIN_DEAL_CENTS)} — below that the fees outweigh the item.` });
    const inviterRole: 'buyer' | 'seller' = role === 'seller' ? 'seller' : 'buyer';
    const me = await deps.repo.getUser(uid);
    if (me && requiresKyc(me.identityTier === 'id_verified', amountCents)) {
      return reply.code(400).send({ error: 'Verify your ID to set up deals over $500.', code: 'kyc_required' });
    }
    // A seller-initiated invite seals the seller's terms the moment it's accepted,
    // so the inviter must already have a card on file (they're the seller here).
    if (inviterRole === 'seller' && !me?.hasCardOnFile) {
      return reply.code(400).send({ error: "Add a card first — you're only ever charged if you don't show up.", code: 'card_required' });
    }
    const digits = String(counterpartyPhone).replace(/[^\d]/g, '');
    if (me && me.phone.replace(/[^\d]/g, '').endsWith(digits)) return reply.code(400).send({ error: "That's your own number — invite the other person." });
    const invitee = (await deps.repo.getUserByPhone(digits)) ?? (await deps.repo.getUserByPhone(String(counterpartyPhone)));
    if (invitee && (await deps.repo.isBlocked(uid, invitee.id))) return reply.code(400).send({ error: "You can't invite this person.", code: 'blocked' });
    const token = deps.makeCtx().newId();
    await deps.repo.createInvite({ token, inviterId: uid, inviterRole, inviteePhone: digits, itemDescription, amountCents, status: 'pending', dealId: null, createdAt: Date.now() });
    // best-effort push if the invitee is already a MeetMe user
    if (invitee) {
      const inviter = await deps.repo.getUser(uid);
      const tokens = await deps.repo.getPushTokens(invitee.id);
      if (tokens.length) void push.send(tokens, { title: 'New MeetMe invite', body: `${inviter?.name ?? 'Someone'} invited you to a $${(amountCents / 100).toFixed(0)} deal.`, data: { inviteToken: token } });
    }
    return { token };
  });

  app.get('/invites', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const me = await deps.repo.getUser(uid);
    if (!me) return { invites: [] };
    const raw = await deps.repo.listPendingInvitesForPhone(me.phone.replace(/[^\d]/g, ''));
    const invites = [];
    for (const i of raw) {
      const inviter = await deps.repo.getUser(i.inviterId);
      invites.push({ token: i.token, inviterName: inviter?.name ?? 'Someone', itemDescription: i.itemDescription, amountCents: i.amountCents, yourRole: i.inviterRole === 'buyer' ? 'seller' : 'buyer' });
    }
    return { invites };
  });

  app.get('/invites/:token', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const inv = await deps.repo.getInvite((req.params as { token: string }).token);
    if (!inv) return reply.code(404).send({ error: 'invite not found' });
    const inviter = await deps.repo.getUser(inv.inviterId);
    return { token: inv.token, inviterName: inviter?.name ?? 'Someone', itemDescription: inv.itemDescription, amountCents: inv.amountCents, status: inv.status, yourRole: inv.inviterRole === 'buyer' ? 'seller' : 'buyer' };
  });

  app.post('/invites/:token/decline', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const inv = await deps.repo.getInvite((req.params as { token: string }).token);
    if (!inv) return reply.code(404).send({ error: 'invite not found' });
    const me = await deps.repo.getUser(uid);
    const isInvitee = !!me && me.phone.replace(/[^\d]/g, '') === inv.inviteePhone;
    if (inv.inviterId !== uid && !isInvitee) return reply.code(403).send({ error: 'not your invite' });
    await deps.repo.cancelInvite(inv.token);
    return { ok: true };
  });

  // Add a card on file ($0 validation) — required to accept a deal as the seller.
  // FakeRail always validates; a real card rail runs a Stripe SetupIntent here.
  app.post('/payment-method', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    if (!(await deps.repo.getUser(uid))) return reply.code(404).send({ error: 'unknown user' });
    // The client collects the card and sends ONLY the last 4 (test mode — a real rail runs a
    // Stripe SetupIntent and returns a token). Fall back to the rail's mock last4 if none given.
    const body = (req.body ?? {}) as { last4?: string };
    let last4 = typeof body.last4 === 'string' && /^\d{4}$/.test(body.last4) ? body.last4 : null;
    if (!last4) {
      const v = await deps.rail.validateCard(uid);
      if (!v.ok) return reply.code(400).send({ error: 'card validation failed', code: 'card_invalid' });
      last4 = v.last4;
    }
    await deps.repo.setCardOnFile(uid, last4);
    return { ok: true, last4 };
  });

  // Mock ID verification — a licensed KYC partner does this for real. Bumps the tier.
  app.post('/kyc/verify', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    await deps.repo.setKyc(uid, 'id_verified', 'verified');
    return { ok: true };
  });

  app.post('/invites/:token/accept', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const token = (req.params as { token: string }).token;
    const r = await acceptInvite(deps.repo, { token, accepterUserId: uid }, deps.makeCtx());
    if (!r.ok) return reply.code(r.code === 'card_required' ? 400 : 409).send({ error: r.reason, code: r.code });
    const inv = await deps.repo.getInvite(token);
    if (inv) {
      const accepter = await deps.repo.getUser(uid);
      const tokens = await deps.repo.getPushTokens(inv.inviterId);
      if (tokens.length) void push.send(tokens, { title: 'Invite accepted', body: `${accepter?.name ?? 'Someone'} accepted your deal invite.`, data: { dealId: r.dealId } });
    }
    return { dealId: r.dealId };
  });

  // Public reputation card for a counterparty: trust signals + your shared deal
  // history with them. No PII (no phone) — name + reputation are public trust signals.
  // Your OWN profile additionally includes the private card-on-file fields.
  app.get('/users/:id/profile', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const u = await deps.repo.getUser(id);
    if (!u) return reply.code(404).send({ error: 'not found' });
    const mine = await deps.repo.listDealsForUser(uid);
    const shared = mine
      .filter((d) => d.buyerId === id || d.sellerId === id)
      .map((d) => ({ id: d.id, itemDescription: d.itemDescription, amountCents: d.amountCents, state: d.state, youWere: d.buyerId === uid ? 'buyer' : 'seller' }));
    return {
      id: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      idVerified: u.identityTier === 'id_verified',
      trustScore: u.trustScore,
      completedDeals: u.completedDeals,
      memberSince: u.acceptedTermsAt,
      blocked: await deps.repo.isBlocked(uid, id),
      shared,
      // self-only: never expose another user's payment details
      ...(id === uid ? { hasCardOnFile: u.hasCardOnFile, cardLast4: u.cardLast4 } : {}),
    };
  });

  // --- safety: block + report ---
  app.post('/users/:id/block', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const target = (req.params as { id: string }).id;
    if (target === uid) return reply.code(400).send({ error: 'cannot block yourself' });
    await deps.repo.blockUser(uid, target);
    return { ok: true };
  });

  // People the caller has blocked — powers the Account screen's blocked list.
  app.get('/blocks', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    return { blocked: await deps.repo.listBlocked(uid) };
  });

  // Unblock — removes only the caller's own block (the other person's, if any, stands).
  app.delete('/users/:id/block', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    await deps.repo.unblockUser(uid, (req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/users/:id/report', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const target = (req.params as { id: string }).id;
    const { reason, dealId } = (req.body ?? {}) as { reason?: string; dealId?: string };
    if (!reason || !reason.trim()) return reply.code(400).send({ error: 'reason required' });
    await deps.repo.reportUser({ reporterId: uid, reportedId: target, dealId: dealId ?? null, reason: reason.trim().slice(0, 300) });
    return { ok: true };
  });

  // Keep the caller's display name in sync with what they signed in as.
  app.post('/profile', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name required' });
    await deps.repo.setUserName(uid, name.trim());
    return { ok: true };
  });

  // --- chat ---
  app.get('/deals/:id/messages', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const rec = await deps.repo.getDeal(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.deal.buyerId !== uid && rec.deal.sellerId !== uid) return reply.code(403).send({ error: 'not a participant' });
    const msgs = await deps.repo.listMessages(id);
    // mint a short-lived signed URL per image; never expose the raw storage path
    const messages = await Promise.all(msgs.map(async (m) => ({
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
      imageUrl: m.imagePath ? await deps.repo.signImageUrl(m.imagePath) : null,
    })));
    return { messages };
  });

  app.post('/deals/:id/messages', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const { body: rawBody, imageBase64, contentType } = (req.body ?? {}) as { body?: string; imageBase64?: string; contentType?: string };
    const body = (rawBody ?? '').trim();
    if (!body && !imageBase64) return reply.code(400).send({ error: 'message body or image required' });
    const rec = await deps.repo.getDeal(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.deal.buyerId !== uid && rec.deal.sellerId !== uid) return reply.code(403).send({ error: 'not a participant' });
    // a block mutes the channel both ways (history stays readable via GET)
    const other = rec.deal.buyerId === uid ? rec.deal.sellerId : rec.deal.buyerId;
    if (await deps.repo.isBlocked(uid, other)) return reply.code(403).send({ error: 'Messaging is unavailable for this deal.', code: 'blocked' });
    let imagePath: string | null = null;
    if (imageBase64) {
      const ct = typeof contentType === 'string' && /^image\/(jpeg|png|webp)$/.test(contentType) ? contentType : 'image/jpeg';
      const bytes = Buffer.from(imageBase64, 'base64');
      if (bytes.length === 0) return reply.code(400).send({ error: 'invalid image' });
      if (bytes.length > 10 * 1024 * 1024) return reply.code(413).send({ error: 'image too large (max 10MB)' });
      imagePath = await deps.repo.putDealImage(id, bytes, ct);
    }
    await deps.repo.addMessage(id, uid, body ? body.slice(0, 1000) : null, imagePath);
    // best-effort push to the other party
    const otherId = rec.deal.buyerId === uid ? rec.deal.sellerId : rec.deal.buyerId;
    const sender = await deps.repo.getUser(uid);
    const tokens = await deps.repo.getPushTokens(otherId);
    const preview = body ? body.slice(0, 120) : '📷 Photo';
    if (tokens.length) void push.send(tokens, { title: sender?.name ?? 'New message', body: preview, data: { dealId: id } });
    return { ok: true };
  });

  // Register this device's Expo push token for the caller.
  app.post('/push-token', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const { token, platform } = (req.body ?? {}) as { token?: string; platform?: string };
    if (!token) return reply.code(400).send({ error: 'token required' });
    await deps.repo.savePushToken({ userId: uid, token, platform });
    return { ok: true };
  });

  // Geocode a typed address/place to a point (for "where you're coming from" + custom spots).
  app.get('/geocode', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    if (!deps.mapsKey) return reply.code(400).send({ error: 'maps not configured' });
    const q = (req.query as { q?: string }).q;
    if (!q || !q.trim()) return reply.code(400).send({ error: 'q required' });
    const r = await geocode(q, deps.mapsKey);
    if (!r) return reply.code(404).send({ error: 'no match for that address' });
    return r;
  });

  // Fair meetup suggestions: needs both parties' "coming from" locations (posted via
  // /location). Finds safe spots near the midpoint, ranked by BALANCED drive time.
  app.get('/deals/:id/meetup-suggestions', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    if (!deps.mapsKey) return reply.code(400).send({ error: 'maps not configured' });
    const id = (req.params as { id: string }).id;
    const rec = await deps.repo.getDeal(id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.deal.buyerId !== uid && rec.deal.sellerId !== uid) return reply.code(403).send({ error: 'not a participant' });

    const locs = await deps.repo.getLocations(id);
    const bl = locs.find((l) => l.userId === rec.deal.buyerId);
    const sl = locs.find((l) => l.userId === rec.deal.sellerId);
    if (!bl || !sl) return { needLocation: true, haveBuyer: !!bl, haveSeller: !!sl, suggestions: [] };

    const mid = midpoint(bl, sl);
    const spots = await findSafeSpots(mid.lat, mid.lng, deps.mapsKey);
    if (spots.length === 0) return { suggestions: [], midpoint: mid };
    const cand = spots.slice(0, 12);
    const times = await driveTimeMatrix([bl, sl], cand, deps.mapsKey);
    const scored = cand.map((s, i) => {
      const tB = times ? times[0][i] : Infinity;
      const tS = times ? times[1][i] : Infinity;
      const known = isFinite(tB) && isFinite(tS);
      const balance = known ? Math.abs(tB - tS) : 999;
      const total = known ? tB + tS : 999;
      const score = (s.tier === 'verified' ? 6 : 0) - balance - total * 0.15;
      return { name: s.name, lat: s.lat, lng: s.lng, category: s.category, tier: s.tier,
               minutesBuyer: isFinite(tB) ? Math.round(tB) : null, minutesSeller: isFinite(tS) ? Math.round(tS) : null, score };
    }).sort((a, b) => b.score - a.score).slice(0, 6);
    return { suggestions: scored, midpoint: mid };
  });

  // Live location ping (geofence). Returns only distance-between + resulting state
  // — never the other party's raw coordinates.
  app.post('/deals/:id/location', async (req, reply) => {
    const uid = await resolveCaller(req);
    if (!uid) return reply.code(401).send({ error: 'auth required' });
    const id = (req.params as { id: string }).id;
    const { lat, lng } = (req.body ?? {}) as { lat?: number; lng?: number };
    if (typeof lat !== 'number' || typeof lng !== 'number') return reply.code(400).send({ error: 'lat and lng required' });
    const r = await submitLocation(deps.repo, deps.rail, { dealId: id, userId: uid, lat, lng }, deps.makeCtx());
    if (!r.ok) return reply.code(r.code === 'not_found' ? 404 : 403).send({ error: r.reason });
    if (r.coLocated) {
      const rec = await deps.repo.getDeal(id);
      if (rec) void notifyDealState(deps.repo, push, rec.deal); // "you're both here"
    }
    return { distanceM: r.distanceM, coLocated: r.coLocated, state: r.state };
  });

  if (deps.allowDev) {
    app.post('/dev/deals/:id/settle-funding', async (req) => {
      await markFundingSettled(deps.repo, (req.params as { id: string }).id);
      return { ok: true };
    });
    app.post('/dev/deals/:id/return-funding', async (req) => {
      await markFundingReturned(deps.repo, (req.params as { id: string }).id);
      return { ok: true };
    });
    // Stand-in for the support/admin console: resolve a dispute (release/refund/split).
    app.post('/dev/deals/:id/resolve', async (req, reply) => {
      const { outcome } = (req.body ?? {}) as { outcome?: 'release' | 'refund' | 'split' };
      if (outcome !== 'release' && outcome !== 'refund' && outcome !== 'split') return reply.code(400).send({ error: 'outcome must be release | refund | split' });
      const id = (req.params as { id: string }).id;
      const r = await executeAction(deps.repo, deps.rail, { dealId: id, action: { type: 'RESOLVE_DISPUTE', outcome }, callerUserId: null, channel: 'admin' }, deps.makeCtx());
      if (!r.ok) return reply.code(409).send({ error: r.reason });
      void notifyDealState(deps.repo, push, r.deal);
      return { ok: true, deal: r.deal };
    });
  }

  return app;
}
