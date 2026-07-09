import { describe, it, expect } from 'vitest';
import type { Action } from '@meetme/core';
import { makeServerCtx } from './ctx';
import { MemoryRepo } from './memoryRepo';
import { signup } from './signup';
import { createDealHandler } from './handler';
import { FakeRail } from './rails/fakeRail';
import { executeAction, markFundingReturned, markFundingSettled, type ExecResult } from './payments';

async function setup() {
  const repo = new MemoryRepo();
  const ctx = makeServerCtx(1_700_000_000_000);
  const b = await signup(repo, { phone: `+1555${Math.random()}`, name: 'Maya', isVoip: false }, ctx);
  const s = await signup(repo, { phone: `+1666${Math.random()}`, name: 'Sam', isVoip: false }, ctx);
  if (!b.ok || !s.ok) throw new Error('signup');
  await repo.setCardOnFile(s.user.id, '4242'); // sellers need a card on file to accept
  const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'iPhone 12', amountCents: 300_00 }, ctx);
  if (!created.ok) throw new Error('create');
  return { repo, ctx, buyer: b.user, seller: s.user, dealId: created.deal.id };
}

const ok = (r: ExecResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r;
};

describe('M2 payments — instant rail (RTP) happy path', () => {
  it('funds, gate passes (settled instantly), pays the seller out', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' })); // arms the deal directly
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    ok(await exec(seller.id, { type: 'ARRIVE', party: 'seller' }));
    const revealed = ok(await exec(buyer.id, { type: 'REVEAL_CODE' }));
    const code = (revealed as any).secret.releaseCode;
    ok(await exec(seller.id, { type: 'ENTER_CODE', code }));
    ok(await exec(buyer.id, { type: 'CONFIRM_RECEIVED' }));

    expect((await repo.getDeal(dealId))!.deal.state).toBe('RELEASED');
    const tr = await repo.listTransfers(dealId);
    const fund = tr.find((t) => t.direction === 'fund_buyer')!;
    expect(fund.status).toBe('settled');
    expect(fund.amountCents).toBe(300_00 + 15_00); // price + the $15 deposit pulled, no fee upfront
    const payout = tr.find((t) => t.direction === 'payout_seller')!;
    expect(payout.amountCents).toBe(300_00 - 6_00); // price - the seller's $6 fee share
    expect(tr.some((t) => t.direction === 'refund_buyer' && t.amountCents === 9_00)).toBe(true); // deposit back minus the buyer's $6 fee share
  });
});

describe('M2 seller commitment hold (card on file)', () => {
  it('places the hold when the seller heads out and releases it on completion', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(seller.id, { type: 'HEAD_OUT', actor: 'seller' }));

    const holdId = (await repo.getDeal(dealId))!.deal.sellerHoldId!;
    expect(holdId).toBeTruthy();
    expect(rail.holds.get(holdId)).toMatchObject({ userId: seller.id, amountCents: 15_00, status: 'held' });

    ok(await exec(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    ok(await exec(seller.id, { type: 'ARRIVE', party: 'seller' }));
    const revealed = ok(await exec(buyer.id, { type: 'REVEAL_CODE' }));
    ok(await exec(seller.id, { type: 'ENTER_CODE', code: (revealed as any).secret.releaseCode }));
    ok(await exec(buyer.id, { type: 'CONFIRM_RECEIVED' }));

    expect(rail.holds.get(holdId)!.status).toBe('released'); // never charged on a completed deal
    expect((await repo.getDeal(dealId))!.deal.sellerHoldId).toBeNull();
  });

  it('captures the hold to the buyer when the seller backs out after heading out', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(seller.id, { type: 'HEAD_OUT', actor: 'seller' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' })); // both committed → seller's back-out is a real forfeit
    const holdId = (await repo.getDeal(dealId))!.deal.sellerHoldId!;

    ok(await exec(seller.id, { type: 'CANCEL', actor: 'seller' })); // self-declared no-show

    expect(rail.holds.get(holdId)!.status).toBe('captured');
    expect((await repo.getDeal(dealId))!.deal.sellerHoldId).toBeNull();
    // the captured $15 deposit goes OUT to the buyer (a forward payout), alongside their full escrow refund
    const transfers = await repo.listTransfers(dealId);
    expect(transfers.some((t) => t.direction === 'refund_buyer' && t.amountCents === 300_00 + 15_00)).toBe(true); // escrow made whole
    expect(transfers.some((t) => t.direction === 'payout_buyer' && t.amountCents === 12_00)).toBe(true); // + $12 of the seller's captured deposit
  });

  it('collects off the card even when the seller never headed out (no prior hold)', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    expect((await repo.getDeal(dealId))!.deal.sellerHoldId).toBeNull(); // seller never headed out

    const r = await executeAction(repo, rail, { dealId, action: { type: 'EXPIRE_NO_SHOW', noShow: 'seller' }, callerUserId: null, channel: 'system' }, ctx);
    expect(r.ok).toBe(true);
    // a place-and-capture happened against the card on file
    expect([...rail.holds.values()].some((h) => h.userId === seller.id && h.status === 'captured')).toBe(true);
  });
});

describe('M2 payout-settlement gate (ACH)', () => {
  it('blocks release until funding settles, then allows it', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' }); // pending, low risk
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    ok(await exec(seller.id, { type: 'ARRIVE', party: 'seller' }));
    const revealed = ok(await exec(buyer.id, { type: 'REVEAL_CODE' }));
    const code = (revealed as any).secret.releaseCode;
    ok(await exec(seller.id, { type: 'ENTER_CODE', code }));

    const blocked = await exec(buyer.id, { type: 'CONFIRM_RECEIVED' });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.code).toBe('funding_not_settled');
    expect((await repo.getDeal(dealId))!.deal.state).toBe('CONFIRMING'); // not released
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(false); // no payout yet

    await markFundingSettled(repo, dealId);
    ok(await exec(buyer.id, { type: 'CONFIRM_RECEIVED' }));
    expect((await repo.getDeal(dealId))!.deal.state).toBe('RELEASED');
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(true);
  });
});

describe('M2 risk gate', () => {
  it('declines funding above the risk threshold, no state change', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach', fundingRisk: 90 });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    const r = await exec(buyer.id, { type: 'FUND' });
    expect(!r.ok && r.code).toBe('risk_declined');
    expect((await repo.getDeal(dealId))!.deal.state).toBe('AGREED'); // unchanged
    expect((await repo.listTransfers(dealId)).length).toBe(0); // no funding recorded
  });
});

describe('M2 return safety', () => {
  it('a returned ACH funding keeps the release gate shut — seller is never paid', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    ok(await exec(seller.id, { type: 'ARRIVE', party: 'seller' }));
    const revealed = ok(await exec(buyer.id, { type: 'REVEAL_CODE' }));
    const code = (revealed as any).secret.releaseCode;
    ok(await exec(seller.id, { type: 'ENTER_CODE', code }));

    await markFundingReturned(repo, dealId); // ACH bounced
    const blocked = await exec(buyer.id, { type: 'CONFIRM_RECEIVED' });
    expect(!blocked.ok && blocked.code).toBe('funding_not_settled');
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(false); // no loss
  });
});

describe('buyer-fault no-show respects the settlement gate', () => {
  it('a buyer no-show does NOT pay the seller from unsettled (ACH) escrow, then does once settled', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' }); // pending, does not settle on its own
    const exec = (id: string, a: Action) => executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel: 'user' }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await exec(seller.id, { type: 'HEAD_OUT', actor: 'seller' }));
    ok(await exec(seller.id, { type: 'ARRIVE', party: 'seller' }));

    // the seller's stood-up comp comes from the buyer's escrow, which is still pending —
    // the gate must block it, or MeetMe pays out money it may never collect (ACH can return).
    const sys = (a: Action) => executeAction(repo, rail, { dealId, action: a, callerUserId: null, channel: 'system' }, ctx);
    const blocked = await sys({ type: 'EXPIRE_NO_SHOW', noShow: 'buyer' });
    expect(!blocked.ok && blocked.code).toBe('funding_not_settled');
    expect((await repo.getDeal(dealId))!.deal.state).toBe('EN_ROUTE'); // not resolved
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(false); // no loss

    await markFundingSettled(repo, dealId);
    ok(await sys({ type: 'EXPIRE_NO_SHOW', noShow: 'buyer' }));
    expect((await repo.getDeal(dealId))!.deal.state).toBe('EXPIRED_NO_SHOW');
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(true);
  });
});

describe('dispute resolution disburses on the rail', () => {
  async function toDisputed() {
    const s = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, a: Action) => executeAction(s.repo, rail, { dealId: s.dealId, action: a, callerUserId: id, channel: 'user' }, s.ctx);
    ok(await exec(s.seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(s.buyer.id, { type: 'FUND' }));
    ok(await exec(s.buyer.id, { type: 'OPEN_DISPUTE', actor: 'buyer' }));
    return { ...s, rail, exec };
  }

  it('self-service resolution (both propose split) actually mirrors onto the rail', async () => {
    const { repo, dealId, buyer, seller, exec } = await toDisputed();
    ok(await exec(buyer.id, { type: 'PROPOSE_RESOLUTION', actor: 'buyer', outcome: 'split' }));
    ok(await exec(seller.id, { type: 'PROPOSE_RESOLUTION', actor: 'seller', outcome: 'split' }));

    expect((await repo.getDeal(dealId))!.deal.state).toBe('DISPUTE_RESOLVED');
    const tr = await repo.listTransfers(dealId);
    // a split pays both sides back — transfers must exist, not just the ledger (the bug)
    expect(tr.some((t) => t.direction === 'refund_buyer')).toBe(true);
    expect(tr.some((t) => t.direction === 'payout_seller')).toBe(true);
    void buyer; void seller;
  });
});

describe('dispute-release respects the settlement gate', () => {
  it('blocks a resolve-to-release while the buyer ACH is still pending', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' }); // pending
    const exec = (id: string | null, a: Action, channel: 'user' | 'admin' = 'user') =>
      executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'OPEN_DISPUTE', actor: 'buyer' }));

    const blocked = await exec(null, { type: 'RESOLVE_DISPUTE', outcome: 'release' }, 'admin');
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.code).toBe('funding_not_settled');
    expect((await repo.getDeal(dealId))!.deal.state).toBe('DISPUTED'); // not resolved
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(false);

    await markFundingSettled(repo, dealId);
    ok(await exec(null, { type: 'RESOLVE_DISPUTE', outcome: 'release' }, 'admin'));
    expect((await repo.getDeal(dealId))!.deal.state).toBe('DISPUTE_RESOLVED');
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(true);
  });

  it('blocks a resolve-to-SPLIT while the buyer ACH is still pending (split pays the seller too)', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' }); // pending
    const exec = (id: string | null, a: Action, channel: 'user' | 'admin' = 'user') =>
      executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'OPEN_DISPUTE', actor: 'buyer' }));

    const blocked = await exec(null, { type: 'RESOLVE_DISPUTE', outcome: 'split' }, 'admin');
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.code).toBe('funding_not_settled'); // split pays the seller from unsettled escrow — must wait
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(false);

    await markFundingSettled(repo, dealId);
    ok(await exec(null, { type: 'RESOLVE_DISPUTE', outcome: 'split' }, 'admin'));
    expect((await repo.listTransfers(dealId)).some((t) => t.direction === 'payout_seller')).toBe(true);
  });
});

describe('M2 scheduled meetup — commitment hold lifecycle', () => {
  it('releases the seller hold (placed at CONFIRM) when a scheduled deal is cancelled before heading out', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    const exec = (id: string, a: Action) => executeAction(repo, rail, { dealId, action: a, callerUserId: id, channel: 'user' }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    // scheduled meetup: the seller's $15 hold is placed at CONFIRM — before anyone heads out
    ok(await exec(seller.id, { type: 'PROPOSE_MEETUP', actor: 'seller', name: 'Precinct', lat: 1, lng: 2, custom: false, time: ctx.now + 60 * 60_000 }));
    ok(await exec(buyer.id, { type: 'CONFIRM_MEETUP', actor: 'buyer' }));
    const holdId = (await repo.getDeal(dealId))!.deal.sellerHoldId!;
    expect(rail.holds.get(holdId)!.status).toBe('held'); // hold exists, deal still ARMED, nobody headed out

    ok(await exec(buyer.id, { type: 'CANCEL', actor: 'buyer' })); // cancel before heading out
    expect((await repo.getDeal(dealId))!.deal.state).toBe('REFUNDED');
    expect(rail.holds.get(holdId)!.status).toBe('released'); // NOT orphaned on the seller's card
    expect((await repo.getDeal(dealId))!.deal.sellerHoldId).toBeNull();
  });
});

describe('M2 refund push', () => {
  it('cancel after funding mirrors the ledger refund onto the rail', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' });
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);
    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(buyer.id, { type: 'CANCEL', actor: 'buyer' }));
    expect((await repo.getDeal(dealId))!.deal.state).toBe('REFUNDED');
    const refunds = (await repo.listTransfers(dealId)).filter((t) => t.direction === 'refund_buyer');
    expect(refunds.some((t) => t.amountCents === 300_00 + 15_00)).toBe(true); // full refund to buyer
  });
});
