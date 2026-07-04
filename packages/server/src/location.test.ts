import { describe, it, expect } from 'vitest';
import type { Action } from '@meetme/core';
import { makeServerCtx } from './ctx';
import { MemoryRepo } from './memoryRepo';
import { signup } from './signup';
import { createDealHandler } from './handler';
import { executeAction } from './payments';
import { FakeRail } from './rails/fakeRail';
import { submitLocation } from './location';

async function enRouteDeal() {
  const repo = new MemoryRepo();
  const ctx = makeServerCtx(1_700_000_000_000);
  const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
  const b = await signup(repo, { phone: `+1555${Math.random()}`, name: 'Maya', isVoip: false }, ctx);
  const s = await signup(repo, { phone: `+1666${Math.random()}`, name: 'Sam', isVoip: false }, ctx);
  if (!b.ok || !s.ok) throw new Error('signup');
  const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'x', amountCents: 300_00 }, ctx);
  if (!created.ok) throw new Error('create');
  const dealId = created.deal.id;
  const exec = (id: string, a: Action) => executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel: 'user' }, ctx);
  await exec(s.user.id, { type: 'ACCEPT_TERMS' });
  await exec(b.user.id, { type: 'FUND' });
  await exec(s.user.id, { type: 'POST_STAKE' });
  await exec(b.user.id, { type: 'HEAD_OUT', actor: 'buyer' });
  return { repo, ctx, rail, buyer: b.user, seller: s.user, dealId };
}

describe('M4 geofence — co-location auto-arrival', () => {
  it('auto-arrives both parties only once the two phones come together', async () => {
    const { repo, ctx, rail, buyer, seller, dealId } = await enRouteDeal();

    // one ping: only the buyer's location known -> no distance, no co-location
    const r1 = await submitLocation(repo, rail, { dealId, userId: buyer.id, lat: 40.7128, lng: -74.006 }, ctx);
    expect(r1.ok && r1.coLocated).toBe(false);
    expect(r1.ok && r1.distanceM).toBeNull();
    expect((await repo.getDeal(dealId))!.deal.state).toBe('EN_ROUTE');

    // seller far away -> big distance, still no co-location
    const r2 = await submitLocation(repo, rail, { dealId, userId: seller.id, lat: 40.72, lng: -74.01 }, ctx);
    expect(r2.ok && r2.coLocated).toBe(false);
    expect(r2.ok && (r2.distanceM ?? 0)).toBeGreaterThan(60);
    expect((await repo.getDeal(dealId))!.deal.state).toBe('EN_ROUTE');

    // seller arrives next to the buyer -> co-located -> AT_MEETUP, both marked present
    const r3 = await submitLocation(repo, rail, { dealId, userId: seller.id, lat: 40.71283, lng: -74.00605 }, ctx);
    expect(r3.ok && r3.coLocated).toBe(true);
    expect(r3.ok && r3.state).toBe('AT_MEETUP');
    const rec = await repo.getDeal(dealId);
    expect(rec!.deal.state).toBe('AT_MEETUP');
    expect(rec!.deal.buyerArrived && rec!.deal.sellerArrived).toBe(true);
  });

  it('rejects a location ping from a non-participant', async () => {
    const { repo, ctx, rail, dealId } = await enRouteDeal();
    const r = await submitLocation(repo, rail, { dealId, userId: 'stranger', lat: 1, lng: 1 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('forbidden');
  });
});
