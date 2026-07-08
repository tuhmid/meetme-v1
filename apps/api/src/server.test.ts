import { describe, it, expect } from 'vitest';
import { FakeRail, MemoryRepo, makeServerCtx } from '@meetme/server';
import type { Action } from '@meetme/core';
import { buildServer } from './server';

describe('M3 API — drives a full deal over HTTP (the walking skeleton spine)', () => {
  it('two parties take one marketplace deal DRAFT -> RELEASED through the routes', async () => {
    const app = buildServer({
      repo: new MemoryRepo(),
      rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }),
      makeCtx: () => makeServerCtx(),
      allowDev: true,
    });

    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> =>
      app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya Chen' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam Rivera' })).json().userId as string;

    const created = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'iPhone 12', amountCents: 300_00 }, buyer)).json();
    const dealId = created.dealId as string;
    expect(dealId).toBeTruthy();

    const act = async (uid: string, action: Action) => {
      const res = await post(`/deals/${dealId}/actions`, { action }, uid);
      expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
      return res.json();
    };

    await post('/payment-method', {}, seller); // card on file — required to accept as seller
    await act(seller, { type: 'ACCEPT_TERMS' });
    await act(buyer, { type: 'FUND' }); // arms the deal — no seller stake turn
    await act(buyer, { type: 'HEAD_OUT', actor: 'buyer' });
    await act(buyer, { type: 'ARRIVE', party: 'buyer' });
    await act(seller, { type: 'ARRIVE', party: 'seller' });
    const revealed = await act(buyer, { type: 'REVEAL_CODE' });
    const code = revealed.secret.releaseCode as string;
    await act(seller, { type: 'ENTER_CODE', code });
    await act(buyer, { type: 'CONFIRM_RECEIVED' });

    const view = (await get(`/deals/${dealId}`, buyer)).json();
    expect(view.deal.state).toBe('RELEASED');
    expect(view.buyerName).toBe('Maya Chen'); // names for the live-map avatars
    expect(view.sellerName).toBe('Sam Rivera');
    expect(view.transfers.some((t: any) => t.direction === 'payout_seller')).toBe(true);

    // home list shows the deal for each party
    expect((await get('/deals', seller)).json().deals.length).toBe(1);
  });

  it('rejects unauthorized and wrong-role calls over HTTP', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx() });
    const noAuth: any = await app.inject({ method: 'GET', url: '/deals' });
    expect(noAuth.statusCode).toBe(401);
  });

  it('accepts a real Supabase JWT via verifyToken; rejects bad tokens and the dev shortcut when allowDev is off', async () => {
    const app = buildServer({
      repo: new MemoryRepo(),
      rail: new FakeRail({ instantSettle: true }),
      makeCtx: () => makeServerCtx(),
      verifyToken: async (jwt) => (jwt === 'good-token' ? 'user-123' : null),
      // allowDev omitted
    });
    const good: any = await app.inject({ method: 'GET', url: '/deals', headers: { authorization: 'Bearer good-token' } });
    expect(good.statusCode).toBe(200);
    const bad: any = await app.inject({ method: 'GET', url: '/deals', headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
    const dev: any = await app.inject({ method: 'GET', url: '/deals', headers: { authorization: 'Bearer dev:user-123' } });
    expect(dev.statusCode).toBe(401); // dev shortcut is disabled without allowDev
  });

  it('deletes a DRAFT deal but refuses to delete an active one', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const del = (url: string, uid: string): Promise<any> => app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'x', amountCents: 300_00 }, buyer)).json().dealId as string;

    // DRAFT -> deletable
    expect((await del(`/deals/${dealId}`, buyer)).statusCode).toBe(200);
    const gone: any = await app.inject({ method: 'GET', url: `/deals/${dealId}`, headers: { authorization: `Bearer dev:${buyer}` } });
    expect(gone.statusCode).toBe(404);

    // an accepted (AGREED) deal is not deletable
    const d2 = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'y', amountCents: 300_00 }, buyer)).json().dealId as string;
    await post('/payment-method', {}, seller);
    await post(`/deals/${d2}/actions`, { action: { type: 'ACCEPT_TERMS' } }, seller);
    expect((await del(`/deals/${d2}`, buyer)).statusCode).toBe(409);
  });

  it('invite by phone: invitee sees it, accepts, and a shared deal is created', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;

    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    const token = (await post('/invites', { counterpartyPhone: '+15552220000', itemDescription: 'iPhone 12', amountCents: 300_00 }, maya)).json().token as string;
    const inbox = (await get('/invites', sam)).json().invites;
    expect(inbox.some((i: any) => i.token === token && i.inviterName === 'Maya')).toBe(true);

    // Sam is the seller — accepting seals terms, so a card is required first.
    const noCard = await post(`/invites/${token}/accept`, {}, sam);
    expect(noCard.statusCode).toBe(400);
    expect(noCard.json().code).toBe('card_required');
    await post('/payment-method', {}, sam);

    const accepted = await post(`/invites/${token}/accept`, {}, sam);
    expect(accepted.statusCode).toBe(200);
    const dealId = accepted.json().dealId as string;
    const view = (await get(`/deals/${dealId}`, sam)).json();
    expect(view.deal.buyerId).toBe(maya);
    expect(view.deal.sellerId).toBe(sam);
    expect(view.deal.state).toBe('AGREED'); // no separate Accept-terms turn — buyer just funds next
  });

  it('seller-initiated invite: the inviter (seller) needs a card up front; accepter lands in AGREED as buyer', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;

    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string; // the seller/inviter
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string; // the buyer/accepter

    const blocked = await post('/invites', { counterpartyPhone: '+15551110000', itemDescription: 'Concert ticket', amountCents: 80_00, role: 'seller' }, sam);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('card_required');

    await post('/payment-method', {}, sam);
    const token = (await post('/invites', { counterpartyPhone: '+15551110000', itemDescription: 'Concert ticket', amountCents: 80_00, role: 'seller' }, sam)).json().token as string;

    const accepted = await post(`/invites/${token}/accept`, {}, maya); // buyer accepts — no card needed
    expect(accepted.statusCode).toBe(200);
    const view = (await get(`/deals/${accepted.json().dealId}`, maya)).json();
    expect(view.deal.sellerId).toBe(sam);
    expect(view.deal.buyerId).toBe(maya);
    expect(view.deal.state).toBe('AGREED');
  });

  it('profile name sync: POST /profile updates the name the counterparty sees', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Old Name' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'x', amountCents: 100_00 }, buyer)).json().dealId as string;

    await post('/profile', { name: 'Tahmid' }, buyer);
    const view = (await get(`/deals/${dealId}`, seller)).json();
    expect(view.buyerName).toBe('Tahmid'); // counterparty sees the updated name
  });

  it('dispute flow: open -> both statements -> support resolves (refund), funds unfrozen to buyer', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const act = (uid: string, action: Action) => post(`/deals/${dealId}/actions`, { action }, uid);

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'iPhone 12', amountCents: 300_00 }, buyer)).json().dealId as string;
    await post('/payment-method', {}, seller);
    await act(seller, { type: 'ACCEPT_TERMS' });
    await act(buyer, { type: 'FUND' }); // -> ARMED

    await act(buyer, { type: 'OPEN_DISPUTE', actor: 'buyer' });
    expect((await get(`/deals/${dealId}`, buyer)).json().deal.state).toBe('DISPUTED');
    await act(buyer, { type: 'SUBMIT_POSITION', actor: 'buyer', text: 'never got it' });
    await act(seller, { type: 'SUBMIT_POSITION', actor: 'seller', text: 'i handed it over' });
    expect((await get(`/deals/${dealId}`, buyer)).json().deal.disputePositions.length).toBe(2);

    const resolved = await post(`/dev/deals/${dealId}/resolve`, { outcome: 'refund' });
    expect(resolved.statusCode).toBe(200);
    const done = (await get(`/deals/${dealId}`, buyer)).json();
    expect(done.deal.state).toBe('DISPUTE_RESOLVED');
    expect(done.transfers.some((t: any) => t.direction === 'refund_buyer')).toBe(true);
  });

  it('ratings: both sides rate after release and trust scores update', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const act = (uid: string, action: Action) => post(`/deals/${dealId}/actions`, { action }, uid);

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'iPhone 12', amountCents: 300_00 }, buyer)).json().dealId as string;
    await post('/payment-method', {}, seller);
    await act(seller, { type: 'ACCEPT_TERMS' });
    await act(buyer, { type: 'FUND' });
    await act(buyer, { type: 'HEAD_OUT', actor: 'buyer' });
    await act(buyer, { type: 'ARRIVE', party: 'buyer' });
    await act(seller, { type: 'ARRIVE', party: 'seller' });
    const code = (await act(buyer, { type: 'REVEAL_CODE' })).json().secret.releaseCode as string;
    await act(seller, { type: 'ENTER_CODE', code });
    await act(buyer, { type: 'CONFIRM_RECEIVED' }); // RELEASED

    await act(buyer, { type: 'RATE', actor: 'buyer', stars: 5 });
    await act(seller, { type: 'RATE', actor: 'seller', stars: 4 });

    const view = (await get(`/deals/${dealId}`, buyer)).json();
    expect(view.deal.ratings.buyer).toBe(5);
    expect(view.deal.ratings.seller).toBe(4);
    expect(view.sellerTrust).toBe(100); // buyer's 5★ -> 5/5*100
    expect(view.buyerTrust).toBe(80); //  seller's 4★ -> 4/5*100
  });

  it('card gate: the seller cannot accept terms without a card on file; adding one unlocks it', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'x', amountCents: 100_00 }, buyer)).json().dealId as string;

    const blocked = await post(`/deals/${dealId}/actions`, { action: { type: 'ACCEPT_TERMS' } }, seller);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('card_required');

    const card = await post('/payment-method', {}, seller);
    expect(card.statusCode).toBe(200);
    expect(card.json().last4).toBe('4242'); // FakeRail's stub card

    const accepted = await post(`/deals/${dealId}/actions`, { action: { type: 'ACCEPT_TERMS' } }, seller);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().deal.state).toBe('AGREED');
  });

  it('payment-method requires auth', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx() });
    expect(((await app.inject({ method: 'POST', url: '/payment-method', payload: {} })) as any).statusCode).toBe(401);
  });

  it('KYC gate: a deal over $500 needs ID verification; verifying unlocks it', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    const blocked = await post('/deals', { counterpartyUserId: seller, itemDescription: 'watch', amountCents: 600_00 }, buyer);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('kyc_required');

    await post('/kyc/verify', {}, buyer);
    const okres = await post('/deals', { counterpartyUserId: seller, itemDescription: 'watch', amountCents: 600_00 }, buyer);
    expect(okres.statusCode).toBe(200);
  });

  it('an invite can be declined and disappears from the inbox', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const token = (await post('/invites', { counterpartyPhone: '+15552220000', itemDescription: 'x', amountCents: 100_00 }, maya)).json().token as string;
    expect((await get('/invites', sam)).json().invites.length).toBe(1);
    expect((await post(`/invites/${token}/decline`, {}, sam)).statusCode).toBe(200);
    expect((await get('/invites', sam)).json().invites.length).toBe(0);
  });

  it('self-service dispute: both propose split -> auto-resolves (no admin)', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const act = (uid: string, action: Action) => post(`/deals/${dealId}/actions`, { action }, uid);
    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'x', amountCents: 300_00 }, buyer)).json().dealId as string;
    await post('/payment-method', {}, seller);
    await act(seller, { type: 'ACCEPT_TERMS' });
    await act(buyer, { type: 'FUND' });
    await act(buyer, { type: 'OPEN_DISPUTE', actor: 'buyer' });
    await act(buyer, { type: 'PROPOSE_RESOLUTION', actor: 'buyer', outcome: 'split' });
    expect((await get(`/deals/${dealId}`, buyer)).json().deal.state).toBe('DISPUTED'); // one proposal
    await act(seller, { type: 'PROPOSE_RESOLUTION', actor: 'seller', outcome: 'split' });
    expect((await get(`/deals/${dealId}`, buyer)).json().deal.state).toBe('DISPUTE_RESOLVED'); // agreed
  });

  it('chat: participants send + read; a stranger is blocked', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const stranger = (await post('/signup', { phone: '+15553330000', name: 'Eve' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya)).json().dealId as string;

    expect((await post(`/deals/${dealId}/messages`, { body: 'blue jacket, 5 min out' }, maya)).statusCode).toBe(200);
    const msgs = (await get(`/deals/${dealId}/messages`, sam)).json().messages;
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toBe('blue jacket, 5 min out');
    expect(msgs[0].senderId).toBe(maya);
    expect((await get(`/deals/${dealId}/messages`, stranger)).statusCode).toBe(403);
    expect((await post(`/deals/${dealId}/messages`, { body: 'hi' }, stranger)).statusCode).toBe(403);
  });

  it('chat: an image message round-trips with a signed URL; empty is rejected', async () => {
    const app = buildServer({ repo: new MemoryRepo(), rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya)).json().dealId as string;

    const b64 = 'aGVsbG8='; // any non-empty bytes stand in for image data
    expect((await post(`/deals/${dealId}/messages`, { imageBase64: b64, contentType: 'image/png' }, maya)).statusCode).toBe(200); // image-only
    expect((await post(`/deals/${dealId}/messages`, { body: 'here it is', imageBase64: b64 }, sam)).statusCode).toBe(200); // text + image

    const msgs = (await get(`/deals/${dealId}/messages`, sam)).json().messages;
    expect(msgs.length).toBe(2);
    expect(msgs[0].body).toBeNull();
    expect(typeof msgs[0].imageUrl).toBe('string'); // signed URL minted
    expect(msgs[1].body).toBe('here it is');
    expect(msgs[1].imageUrl).toBeTruthy();

    expect((await post(`/deals/${dealId}/messages`, {}, maya)).statusCode).toBe(400); // no body, no image
  });

  it('geofence: two location pings coming together auto-arrive both parties (EN_ROUTE -> AT_MEETUP)', async () => {
    const app = buildServer({
      repo: new MemoryRepo(),
      rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }),
      makeCtx: () => makeServerCtx(),
      allowDev: true,
    });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;

    const buyer = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const seller = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: seller, itemDescription: 'x', amountCents: 300_00 }, buyer)).json().dealId as string;
    const act = (uid: string, action: Action) => post(`/deals/${dealId}/actions`, { action }, uid);
    await post('/payment-method', {}, seller);
    await act(seller, { type: 'ACCEPT_TERMS' });
    await act(buyer, { type: 'FUND' });
    await act(buyer, { type: 'HEAD_OUT', actor: 'buyer' }); // -> EN_ROUTE

    await post(`/deals/${dealId}/location`, { lat: 40.7128, lng: -74.006 }, buyer);
    const res = (await post(`/deals/${dealId}/location`, { lat: 40.71283, lng: -74.00605 }, seller)).json();
    expect(res.coLocated).toBe(true);
    expect(res.state).toBe('AT_MEETUP');
  });
});

describe('safety — block & report', () => {
  const setup = () => {
    const repo = new MemoryRepo();
    const app = buildServer({ repo, rail: new FakeRail({ instantSettle: true }), makeCtx: () => makeServerCtx(), allowDev: true });
    const post = (url: string, payload: object, uid?: string): Promise<any> =>
      app.inject({ method: 'POST', url, payload, headers: uid ? { authorization: `Bearer dev:${uid}` } : {} }) as Promise<any>;
    const get = (url: string, uid: string): Promise<any> => app.inject({ method: 'GET', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    return { repo, app, post, get };
  };

  it('blocking a user prevents starting a new deal in either direction', async () => {
    const { repo, post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    expect((await post(`/users/${sam}/block`, {}, maya)).statusCode).toBe(200);
    expect(await repo.isBlocked(maya, sam)).toBe(true);
    expect(await repo.isBlocked(sam, maya)).toBe(true); // either direction

    // Maya (the blocker) can't create a deal with Sam...
    const a = await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya);
    expect(a.statusCode).toBe(403);
    // ...and Sam can't create one with Maya either.
    const b = await post('/deals', { counterpartyUserId: maya, itemDescription: 'x', amountCents: 100_00 }, sam);
    expect(b.statusCode).toBe(403);
  });

  it('blocking prevents inviting the blocked user', async () => {
    const { post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    await post(`/users/${sam}/block`, {}, maya);
    const inv = await post('/invites', { counterpartyPhone: '+15552220000', itemDescription: 'x', amountCents: 100_00 }, maya);
    expect(inv.statusCode).toBe(400);
    expect(inv.json().code).toBe('blocked');
  });

  it('you cannot block yourself', async () => {
    const { post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    expect((await post(`/users/${maya}/block`, {}, maya)).statusCode).toBe(400);
  });

  it('reporting a user records a report; reason is required', async () => {
    const { repo, post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    expect((await post(`/users/${sam}/report`, {}, maya)).statusCode).toBe(400); // no reason
    expect((await post(`/users/${sam}/report`, { reason: 'scam' }, maya)).statusCode).toBe(200);
    expect(repo.reports.length).toBe(1);
    expect(repo.reports[0]).toMatchObject({ reporterId: maya, reportedId: sam, reason: 'scam' });
  });

  it('block & report require auth', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/users/x/block', payload: {} }) as any).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/users/x/report', payload: { reason: 'y' } }) as any).statusCode).toBe(401);
  });

  it('a block also mutes in-deal chat (both ways), while history stays readable', async () => {
    const { post, get } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    const dealId = (await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya)).json().dealId as string;
    await post('/payment-method', {}, sam);
    await post(`/deals/${dealId}/actions`, { action: { type: 'ACCEPT_TERMS' } }, sam);
    expect((await post(`/deals/${dealId}/messages`, { body: 'hi' }, maya)).statusCode).toBe(200);

    await post(`/users/${sam}/block`, {}, maya);
    expect((await post(`/deals/${dealId}/messages`, { body: 'still there?' }, maya)).statusCode).toBe(403);
    expect((await post(`/deals/${dealId}/messages`, { body: 'hello?' }, sam)).statusCode).toBe(403); // muted both ways
    expect((await get(`/deals/${dealId}/messages`, sam)).json().messages.length).toBe(1); // history readable
  });

  it('deals below the $5 minimum are rejected (create + invite)', async () => {
    const { post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    expect((await post('/deals', { counterpartyUserId: sam, itemDescription: 'sticker', amountCents: 4_99 }, maya)).statusCode).toBe(400);
    expect((await post('/invites', { counterpartyPhone: '+15552220000', itemDescription: 'sticker', amountCents: 4_99 }, maya)).statusCode).toBe(400);
    expect((await post('/deals', { counterpartyUserId: sam, itemDescription: 'mug', amountCents: 5_00 }, maya)).statusCode).toBe(200);
  });

  it('you cannot invite your own phone number', async () => {
    const { post } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const r = await post('/invites', { counterpartyPhone: '555-111-0000', itemDescription: 'x', amountCents: 100_00 }, maya);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/own number/i);
  });

  it('profile: public reputation + shared history, no phone leaked', async () => {
    const { post, get } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;
    await post('/deals', { counterpartyUserId: sam, itemDescription: 'iPhone 12', amountCents: 300_00 }, maya);

    const p = (await get(`/users/${sam}/profile`, maya)).json();
    expect(p.name).toBe('Sam');
    expect(typeof p.trustScore).toBe('number');
    expect(p.phone).toBeUndefined(); // no PII
    expect(p.shared.length).toBe(1);
    expect(p.shared[0]).toMatchObject({ itemDescription: 'iPhone 12', youWere: 'buyer' });
    expect(p.blocked).toBe(false);
  });

  it('your own profile includes card-on-file fields; someone else viewing you never sees them', async () => {
    const { post, get } = setup();
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    // no card yet — fields still present on self-view, honestly empty
    const before = (await get(`/users/${maya}/profile`, maya)).json();
    expect(before.hasCardOnFile).toBe(false);
    expect(before.cardLast4).toBeNull();

    await post('/payment-method', {}, maya);
    const self = (await get(`/users/${maya}/profile`, maya)).json();
    expect(self.hasCardOnFile).toBe(true);
    expect(self.cardLast4).toBe('4242');

    // Sam looking at Maya gets the public card only — no payment details
    const asOther = (await get(`/users/${maya}/profile`, sam)).json();
    expect(asOther.hasCardOnFile).toBeUndefined();
    expect(asOther.cardLast4).toBeUndefined();
  });

  it('blocked list: block shows up in GET /blocks, unblock removes it and the pair can deal again', async () => {
    const { app, post, get } = setup();
    const del = (url: string, uid: string): Promise<any> =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer dev:${uid}` } }) as Promise<any>;
    const maya = (await post('/signup', { phone: '+15551110000', name: 'Maya' })).json().userId as string;
    const sam = (await post('/signup', { phone: '+15552220000', name: 'Sam' })).json().userId as string;

    await post(`/users/${sam}/block`, {}, maya);
    expect((await get('/blocks', maya)).json().blocked).toEqual([{ id: sam, name: 'Sam' }]);
    expect((await get('/blocks', sam)).json().blocked).toEqual([]); // the block is Maya's, not Sam's
    expect((await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya)).statusCode).toBe(403);

    expect((await del(`/users/${sam}/block`, maya)).statusCode).toBe(200);
    expect((await get('/blocks', maya)).json().blocked).toEqual([]);
    expect((await post('/deals', { counterpartyUserId: sam, itemDescription: 'x', amountCents: 100_00 }, maya)).statusCode).toBe(200);
  });

  it('blocks list & unblock require auth', async () => {
    const { app } = setup();
    expect(((await app.inject({ method: 'GET', url: '/blocks' })) as any).statusCode).toBe(401);
    expect(((await app.inject({ method: 'DELETE', url: '/users/x/block' })) as any).statusCode).toBe(401);
  });
});
