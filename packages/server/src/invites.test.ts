import { describe, it, expect } from 'vitest';
import { makeServerCtx } from './ctx';
import { MemoryRepo } from './memoryRepo';
import { signup } from './signup';
import { acceptInvite } from './invites';

async function setup() {
  const repo = new MemoryRepo();
  const ctx = makeServerCtx(1_700_000_000_000);
  const inviter = await signup(repo, { phone: '+15551110000', name: 'Maya', isVoip: false }, ctx);
  const accepter = await signup(repo, { phone: '+15552220000', name: 'Sam', isVoip: false }, ctx);
  if (!inviter.ok || !accepter.ok) throw new Error('signup');
  return { repo, ctx, inviter: inviter.user, accepter: accepter.user };
}

describe('M6 invites', () => {
  it('accepting an invite creates the deal (inviter=buyer, accepter=seller) and lands it in AGREED', async () => {
    const { repo, ctx, inviter, accepter } = await setup();
    await repo.setCardOnFile(accepter.id, '4242'); // the accepter is the seller — needs a card
    await repo.createInvite({ token: 'tok1', inviterId: inviter.id, inviterRole: 'buyer', inviteePhone: '15552220000', itemDescription: 'iPhone 12', amountCents: 300_00, status: 'pending', dealId: null, createdAt: ctx.now });

    const r = await acceptInvite(repo, { token: 'tok1', accepterUserId: accepter.id }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rec = await repo.getDeal(r.dealId);
    expect(rec!.deal.buyerId).toBe(inviter.id);
    expect(rec!.deal.sellerId).toBe(accepter.id);
    expect(rec!.deal.state).toBe('AGREED'); // terms sealed on accept — buyer's next tap is Accept & fund

    const inv = await repo.getInvite('tok1');
    expect(inv!.status).toBe('accepted');
    expect(inv!.dealId).toBe(r.dealId);
  });

  it('a seller-accepter with no card gets card_required, and the invite stays open', async () => {
    const { repo, ctx, inviter, accepter } = await setup();
    await repo.createInvite({ token: 'nocard', inviterId: inviter.id, inviterRole: 'buyer', inviteePhone: '15552220000', itemDescription: 'Camera', amountCents: 200_00, status: 'pending', dealId: null, createdAt: ctx.now });

    const r = await acceptInvite(repo, { token: 'nocard', accepterUserId: accepter.id }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('card_required');
    expect((await repo.getInvite('nocard'))!.status).toBe('pending'); // rolled back, reusable

    // add a card and it now goes through, landing in AGREED
    await repo.setCardOnFile(accepter.id, '4242');
    const retry = await acceptInvite(repo, { token: 'nocard', accepterUserId: accepter.id }, ctx);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect((await repo.getDeal(retry.dealId))!.deal.state).toBe('AGREED');
  });

  it('shows a pending invite in the invitee inbox, and rejects reuse / self-accept', async () => {
    const { repo, ctx, inviter, accepter } = await setup();
    await repo.setCardOnFile(accepter.id, '4242');
    await repo.createInvite({ token: 'tok2', inviterId: inviter.id, inviterRole: 'buyer', inviteePhone: '15552220000', itemDescription: 'AirPods', amountCents: 120_00, status: 'pending', dealId: null, createdAt: ctx.now });

    const inbox = await repo.listPendingInvitesForPhone('15552220000');
    expect(inbox.map((i) => i.token)).toContain('tok2');

    expect((await acceptInvite(repo, { token: 'tok2', accepterUserId: inviter.id }, ctx)).ok).toBe(false); // self-accept
    expect((await acceptInvite(repo, { token: 'tok2', accepterUserId: accepter.id }, ctx)).ok).toBe(true);
    expect((await acceptInvite(repo, { token: 'tok2', accepterUserId: accepter.id }, ctx)).ok).toBe(false); // reuse
    expect((await acceptInvite(repo, { token: 'nope', accepterUserId: accepter.id }, ctx)).ok).toBe(false); // unknown
  });

  it('works both ways: a SELLER-initiated invite makes the inviter the seller', async () => {
    const { repo, ctx, inviter, accepter } = await setup();
    await repo.setCardOnFile(inviter.id, '4242'); // the inviter is the seller here — needs a card
    await repo.createInvite({ token: 'sell1', inviterId: inviter.id, inviterRole: 'seller', inviteePhone: '15552220000', itemDescription: 'Concert ticket', amountCents: 80_00, status: 'pending', dealId: null, createdAt: ctx.now });
    const r = await acceptInvite(repo, { token: 'sell1', accepterUserId: accepter.id }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rec = await repo.getDeal(r.dealId);
    expect(rec!.deal.sellerId).toBe(inviter.id); // inviter is the seller
    expect(rec!.deal.buyerId).toBe(accepter.id); // accepter is the buyer
    expect(rec!.deal.state).toBe('AGREED');
  });
});
