import { describe, it, expect } from 'vitest';
import type { Action } from '@meetme/core';
import { makeServerCtx } from './ctx';
import { MemoryRepo } from './memoryRepo';
import { signup } from './signup';
import { createDealHandler } from './handler';
import { executeAction } from './payments';
import { FakeRail } from './rails/fakeRail';
import { dueTransition, runWorkerOnce, DEFAULT_WINDOWS } from './worker';
import type { DealRecord } from './repo';

async function driveTo(state: 'EN_ROUTE' | 'CONFIRMING', railCfg: ConstructorParameters<typeof FakeRail>[0], arrivals: 'buyer' | 'seller' | 'both' | 'none') {
  const repo = new MemoryRepo();
  const ctx = makeServerCtx(1_700_000_000_000);
  const rail = new FakeRail(railCfg);
  const b = await signup(repo, { phone: `+1555${Math.random()}`, name: 'Maya', isVoip: false }, ctx);
  const s = await signup(repo, { phone: `+1666${Math.random()}`, name: 'Sam', isVoip: false }, ctx);
  if (!b.ok || !s.ok) throw new Error('signup');
  await repo.setCardOnFile(s.user.id, '4242'); // sellers need a card on file to accept
  const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'x', amountCents: 300_00 }, ctx);
  if (!created.ok) throw new Error('create');
  const dealId = created.deal.id;
  const exec = (id: string, a: Action) => executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel: 'user' }, ctx);
  await exec(s.user.id, { type: 'ACCEPT_TERMS' });
  await exec(b.user.id, { type: 'FUND' }); // arms the deal directly
  await exec(b.user.id, { type: 'HEAD_OUT', actor: 'buyer' }); // -> EN_ROUTE
  await exec(s.user.id, { type: 'HEAD_OUT', actor: 'seller' }); // both commit to travel (arms the no-show clock)
  if (state === 'EN_ROUTE') {
    if (arrivals === 'buyer' || arrivals === 'both') await exec(b.user.id, { type: 'ARRIVE', party: 'buyer' });
    if (arrivals === 'seller' || arrivals === 'both') await exec(s.user.id, { type: 'ARRIVE', party: 'seller' });
    return { repo, rail, buyer: b.user, seller: s.user, dealId };
  }
  // CONFIRMING: both arrive, reveal, enter code
  await exec(b.user.id, { type: 'ARRIVE', party: 'buyer' });
  await exec(s.user.id, { type: 'ARRIVE', party: 'seller' });
  const revealed = await exec(b.user.id, { type: 'REVEAL_CODE' });
  const code = (revealed as any).secret.releaseCode;
  await exec(s.user.id, { type: 'ENTER_CODE', code });
  return { repo, rail, buyer: b.user, seller: s.user, dealId };
}

describe('worker: dueTransition (pure timing)', () => {
  const base = (over: Partial<DealRecord['deal']> & { state: DealRecord['deal']['state'] }, updatedAt: number): DealRecord => ({
    deal: { buyerArrived: false, sellerArrived: false, buyerHeadedOut: true, sellerHeadedOut: true, ...(over as any) } as any,
    version: 1,
    updatedAt,
  });

  it('no-show fires only for the ABSENT party, only after the window, only if both headed out', () => {
    const now = 1_000_000_000;
    const one = base({ state: 'EN_ROUTE', buyerArrived: true, sellerArrived: false }, now - DEFAULT_WINDOWS.noShowMs - 1);
    expect(dueTransition(one, now, DEFAULT_WINDOWS)).toEqual({ type: 'EXPIRE_NO_SHOW', noShow: 'seller' });
    // before the window: nothing
    const fresh = base({ state: 'EN_ROUTE', buyerArrived: true, sellerArrived: false }, now - 1000);
    expect(dueTransition(fresh, now, DEFAULT_WINDOWS)).toBeNull();
    // neither arrived: no clear fault -> nothing
    const neither = base({ state: 'EN_ROUTE', buyerArrived: false, sellerArrived: false }, now - DEFAULT_WINDOWS.noShowMs - 1);
    expect(dueTransition(neither, now, DEFAULT_WINDOWS)).toBeNull();
    // only one party committed to travel (headed out): no forfeit — you can't be
    // stood up into a forfeit by someone who never agreed to head out
    const onlyBuyerOut = base({ state: 'EN_ROUTE', buyerArrived: true, sellerArrived: false, sellerHeadedOut: false }, now - DEFAULT_WINDOWS.noShowMs - 1);
    expect(dueTransition(onlyBuyerOut, now, DEFAULT_WINDOWS)).toBeNull();
  });

  it('scheduled: no-show anchors to the agreed time + grace (one-sided → absent party; neither → both)', () => {
    const T = 1_000_000_000;
    const g = DEFAULT_WINDOWS.graceMs;
    // buyer at the spot, seller absent, past T+grace -> seller no-show
    const oneSided = base({ state: 'EN_ROUTE', meetupConfirmed: true, meetupTime: T, buyerArrived: true, sellerArrived: false }, T);
    expect(dueTransition(oneSided, T + g + 1, DEFAULT_WINDOWS)).toEqual({ type: 'EXPIRE_NO_SHOW', noShow: 'seller' });
    // neither arrived (even from ARMED) -> refund both
    const neither = base({ state: 'ARMED', meetupConfirmed: true, meetupTime: T, buyerArrived: false, sellerArrived: false }, T);
    expect(dueTransition(neither, T + g + 1, DEFAULT_WINDOWS)).toEqual({ type: 'EXPIRE_NO_SHOW', noShow: 'both' });
    // before the grace: nothing
    expect(dueTransition(oneSided, T + g - 1000, DEFAULT_WINDOWS)).toBeNull();
  });

  it('auto-release fires after the confirm window', () => {
    const now = 1_000_000_000;
    const due = base({ state: 'CONFIRMING' }, now - DEFAULT_WINDOWS.confirmMs - 1);
    expect(dueTransition(due, now, DEFAULT_WINDOWS)).toEqual({ type: 'AUTO_RELEASE' });
    const early = base({ state: 'CONFIRMING' }, now - 1000);
    expect(dueTransition(early, now, DEFAULT_WINDOWS)).toBeNull();
  });
});

describe('worker: runWorkerOnce (driver)', () => {
  it('expires a no-show and pays the present party (RTP)', async () => {
    const { repo, rail, buyer, seller, dealId } = await driveTo('EN_ROUTE', { fundingRail: 'rtp', instantSettle: true }, 'buyer');
    const rec = await repo.getDeal(dealId);
    const now = rec!.updatedAt + DEFAULT_WINDOWS.noShowMs + 1;
    const summary = await runWorkerOnce(repo, rail, () => makeServerCtx(now), { now });
    expect(summary.expired).toBe(1);
    const after = await repo.getDeal(dealId);
    expect(after!.deal.state).toBe('EXPIRED_NO_SHOW');
    expect(after!.deal.faultParty).toBe('seller'); // buyer showed, seller didn't
    // present party (buyer) got refunded on the rail — full escrow refunded, plus the
    // seller's captured deposit paid FORWARD to the buyer (a payout, not a refund)
    const transfers = await repo.listTransfers(dealId);
    expect(transfers.some((t) => t.direction === 'refund_buyer' && t.amountCents === 300_00 + 5_00)).toBe(true);
    expect(transfers.some((t) => t.direction === 'payout_buyer' && t.amountCents === 4_00)).toBe(true); // $4 comp ($1 recovery fee kept)
    expect([...rail.holds.values()].some((h) => h.userId === seller.id && h.status === 'captured')).toBe(true);
    void buyer;
  });

  it('auto-releases a CONFIRMING deal once past the window (RTP, already settled)', async () => {
    const { repo, rail, dealId } = await driveTo('CONFIRMING', { fundingRail: 'rtp', instantSettle: true }, 'both');
    const rec = await repo.getDeal(dealId);
    const now = rec!.updatedAt + DEFAULT_WINDOWS.confirmMs + 1;
    const summary = await runWorkerOnce(repo, rail, () => makeServerCtx(now), { now });
    expect(summary.released).toBe(1);
    expect((await repo.getDeal(dealId))!.deal.state).toBe('RELEASED');
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(true);
  });

  it('syncs ACH settlement from the rail, then the same pass can auto-release', async () => {
    const { repo, rail, dealId } = await driveTo('CONFIRMING', { fundingRail: 'ach' }, 'both');
    // funding is still pending in our records
    expect((await repo.getFundingTransfer(dealId))!.status).not.toBe('settled');
    // the rail reports the ACH cleared (a webhook would do this in prod)
    const ref = (await repo.getFundingTransfer(dealId))!.providerRef!;
    rail.settle(ref);

    const rec = await repo.getDeal(dealId);
    const now = rec!.updatedAt + DEFAULT_WINDOWS.confirmMs + 1;
    const summary = await runWorkerOnce(repo, rail, () => makeServerCtx(now), { now });
    expect(summary.settled).toBe(1);
    expect(summary.released).toBe(1);
    expect((await repo.getDeal(dealId))!.deal.state).toBe('RELEASED');
  });

  it('does nothing before any window elapses', async () => {
    const { repo, rail, dealId } = await driveTo('CONFIRMING', { fundingRail: 'rtp', instantSettle: true }, 'both');
    const rec = await repo.getDeal(dealId);
    const summary = await runWorkerOnce(repo, rail, () => makeServerCtx(rec!.updatedAt + 1000), { now: rec!.updatedAt + 1000 });
    expect(summary.released).toBe(0);
    expect((await repo.getDeal(dealId))!.deal.state).toBe('CONFIRMING');
  });
});
