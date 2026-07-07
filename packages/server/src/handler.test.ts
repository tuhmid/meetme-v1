import { describe, it, expect } from 'vitest';
import { balanced, balanceOf, bankAcct, escrowAcct, PLATFORM_FEES, type Action } from '@meetme/core';
import { makeServerCtx } from './ctx';
import { MemoryRepo } from './memoryRepo';
import { signup } from './signup';
import { createDealHandler, handleAction, type HandlerResult } from './handler';
import { ConflictError } from './repo';

async function setup(amountCents = 300_00) {
  const repo = new MemoryRepo();
  const ctx = makeServerCtx(1_700_000_000_000);
  const b = await signup(repo, { phone: '+15551110000', name: 'Maya Chen', isVoip: false }, ctx);
  const s = await signup(repo, { phone: '+15552220000', name: 'Sam Rivera', isVoip: false }, ctx);
  if (!b.ok || !s.ok) throw new Error('signup failed');
  await repo.setCardOnFile(s.user.id, '4242'); // sellers need a card on file to accept
  const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'iPhone 12', amountCents }, ctx);
  if (!created.ok) throw new Error('create failed: ' + created.reason);
  return { repo, ctx, buyer: b.user, seller: s.user, dealId: created.deal.id };
}

const ok = (r: HandlerResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r;
};

describe('M1 handler — happy path persists atomically and conserves money', () => {
  it('drives DRAFT -> RELEASED through the server, ledger balanced, effects applied', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup(300_00);
    const user = (id: string, action: Action) => handleAction(repo, { dealId, action, callerUserId: id, channel: 'user' }, ctx);

    ok(await user(seller.id, { type: 'ACCEPT_TERMS' }));
    ok(await user(buyer.id, { type: 'FUND' })); // arms the deal — no seller stake turn
    ok(await user(buyer.id, { type: 'HEAD_OUT', actor: 'buyer' }));
    ok(await user(buyer.id, { type: 'ARRIVE', party: 'buyer' }));
    ok(await user(seller.id, { type: 'ARRIVE', party: 'seller' }));
    const revealed = ok(await user(buyer.id, { type: 'REVEAL_CODE' }));
    const code = revealed.secret!.releaseCode; // minted at reveal, delivered to the buyer only
    ok(await user(seller.id, { type: 'ENTER_CODE', code }));
    ok(await user(buyer.id, { type: 'CONFIRM_RECEIVED' }));

    const rec = await repo.getDeal(dealId);
    expect(rec!.deal.state).toBe('RELEASED');
    expect(rec!.version).toBe(8); // 8 committed actions, each bumps the optimistic-lock version

    expect(balanced(repo.ledger)).toBe(true);
    expect(balanceOf(repo.ledger, escrowAcct(dealId))).toBe(0); // escrow drained
    expect(balanceOf(repo.ledger, bankAcct(seller.id))).toBe(300_00 - 4_00); // seller +$296
    expect(balanceOf(repo.ledger, bankAcct(buyer.id))).toBe(-(300_00 + 4_00)); // buyer -$304
    expect(balanceOf(repo.ledger, PLATFORM_FEES)).toBe(2 * 4_00);
    expect(repo.ledger.reduce((s, e) => s + e.amountCents, 0)).toBe(0); // whole system nets 0

    expect((await repo.getUser(buyer.id))!.completedDeals).toBe(1);
    expect((await repo.getUser(seller.id))!.completedDeals).toBe(1);
    // plaintext code is never stored; only the hash is
    expect(rec!.deal.releaseCodeHash).not.toBe(code);
    expect(rec!.deal.releaseCodeHash).toBeTruthy();
  });
});

describe('M1 authorization (who can act)', () => {
  it('rejects wrong-role and non-participant callers, persisting nothing', async () => {
    const { repo, ctx, buyer, seller, dealId } = await setup();
    await handleAction(repo, { dealId, action: { type: 'ACCEPT_TERMS' }, callerUserId: seller.id, channel: 'user' }, ctx);

    // seller cannot FUND (buyer-only)
    const r1 = await handleAction(repo, { dealId, action: { type: 'FUND' }, callerUserId: seller.id, channel: 'user' }, ctx);
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.code).toBe('forbidden');

    // a stranger cannot act at all
    const r2 = await handleAction(repo, { dealId, action: { type: 'FUND' }, callerUserId: 'stranger', channel: 'user' }, ctx);
    expect(!r2.ok && r2.code).toBe('forbidden');

    // a user cannot fire a system-only action
    const r3 = await handleAction(repo, { dealId, action: { type: 'AUTO_RELEASE' }, callerUserId: buyer.id, channel: 'user' }, ctx);
    expect(!r3.ok && r3.code).toBe('forbidden');

    // you can't mark the OTHER party arrived
    const r4 = await handleAction(repo, { dealId, action: { type: 'ARRIVE', party: 'seller' }, callerUserId: buyer.id, channel: 'user' }, ctx);
    expect(!r4.ok && r4.code).toBe('forbidden');

    // deal still only AGREED, nothing funded
    expect((await repo.getDeal(dealId))!.deal.state).toBe('AGREED');
    expect(repo.ledger.length).toBe(0);
  });
});

describe('card-on-file gate (seller commitment)', () => {
  it('a seller without a card cannot ACCEPT_TERMS; adding one unlocks it', async () => {
    const repo = new MemoryRepo();
    const ctx = makeServerCtx(1_700_000_000_000);
    const b = await signup(repo, { phone: '+15551110001', name: 'Maya', isVoip: false }, ctx);
    const s = await signup(repo, { phone: '+15552220001', name: 'Sam', isVoip: false }, ctx);
    if (!b.ok || !s.ok) throw new Error('signup failed');
    const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'x', amountCents: 100_00 }, ctx);
    if (!created.ok) throw new Error('create failed');

    const r = await handleAction(repo, { dealId: created.deal.id, action: { type: 'ACCEPT_TERMS' }, callerUserId: s.user.id, channel: 'user' }, ctx);
    expect(!r.ok && r.code).toBe('card_required');
    expect((await repo.getDeal(created.deal.id))!.deal.state).toBe('DRAFT'); // nothing committed

    await repo.setCardOnFile(s.user.id, '4242');
    const r2 = await handleAction(repo, { dealId: created.deal.id, action: { type: 'ACCEPT_TERMS' }, callerUserId: s.user.id, channel: 'user' }, ctx);
    expect(r2.ok).toBe(true);
    expect((await repo.getUser(s.user.id))!.cardLast4).toBe('4242');
  });
});

describe('M1 rejected transition persists nothing', () => {
  it('FUND on a DRAFT deal is rejected and writes no ledger', async () => {
    const { repo, ctx, buyer, dealId } = await setup();
    const r = await handleAction(repo, { dealId, action: { type: 'FUND' }, callerUserId: buyer.id, channel: 'user' }, ctx);
    expect(!r.ok && r.code).toBe('rejected');
    expect((await repo.getDeal(dealId))!.deal.state).toBe('DRAFT');
    expect((await repo.getDeal(dealId))!.version).toBe(0);
    expect(repo.ledger.length).toBe(0);
  });
});

describe('M1 optimistic concurrency', () => {
  it('a stale commit conflicts (no lost updates)', async () => {
    const { repo, ctx, dealId } = await setup();
    const rec = await repo.getDeal(dealId); // version 0
    await repo.commit(dealId, 0, { deal: { ...rec!.deal, state: 'AGREED' }, events: [], ledger: [], effects: [] }); // now v1
    await expect(repo.commit(dealId, 0, { deal: rec!.deal, events: [], ledger: [], effects: [] })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('M1 signup guards (sybil / VoIP / terms)', () => {
  it('blocks VoIP numbers and duplicate phones, and gates deal creation on accepted terms', async () => {
    const repo = new MemoryRepo();
    const ctx = makeServerCtx(1_700_000_000_000);

    expect((await signup(repo, { phone: '+1', name: 'A', isVoip: true }, ctx)).ok).toBe(false); // VoIP blocked
    const first = await signup(repo, { phone: '+15553334444', name: 'A', isVoip: false }, ctx);
    expect(first.ok).toBe(true);
    expect((await signup(repo, { phone: '+15553334444', name: 'B', isVoip: false }, ctx)).ok).toBe(false); // duplicate phone

    // a user who never accepted terms cannot create a deal
    await repo.addUser({ id: 'no-terms', phone: '+19', phoneIsVoip: false, name: 'NT', avatarColor: '#000', identityTier: 'phone', kycStatus: 'none', trustScore: 50, completedDeals: 0, acceptedTermsAt: null, hasCardOnFile: false, cardLast4: null });
    const other = first.ok ? first.user.id : '';
    const r = await createDealHandler(repo, { creatorUserId: 'no-terms', counterpartyUserId: other, itemDescription: 'x', amountCents: 100_00 }, ctx);
    expect(!r.ok && r.code).toBe('forbidden');
  });
});
