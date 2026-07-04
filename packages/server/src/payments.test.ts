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
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(seller.id, { type: 'POST_STAKE' }));
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
    expect(fund.amountCents).toBe(300_00 + 4_00 + 5_00); // price + fee + commitment pulled
    const payout = tr.find((t) => t.direction === 'payout_seller')!;
    expect(payout.amountCents).toBe(300_00 - 4_00 + 5_00); // price - fee + commitment back
    expect(tr.some((t) => t.direction === 'refund_buyer' && t.amountCents === 5_00)).toBe(true); // buyer commitment back
  });
});

describe('M2 payout-settlement gate (ACH)', () => {
  it('blocks release until funding settles, then allows it', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    const rail = new FakeRail({ fundingRail: 'ach' }); // pending, low risk
    const exec = (id: string, action: Action) => executeAction(repo, rail, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await exec(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await exec(buyer.id, { type: 'FUND' }));
    ok(await exec(seller.id, { type: 'POST_STAKE' }));
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
    ok(await exec(seller.id, { type: 'POST_STAKE' }));
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
    expect(refunds.some((t) => t.amountCents === 300_00 + 4_00 + 5_00)).toBe(true); // full refund to buyer
  });
});
