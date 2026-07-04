import { describe, it, expect } from 'vitest';
import { applyAction, createDeal } from './machine';
import { balanced, balanceOf, bankAcct, escrowAcct, PLATFORM_FEES, PLATFORM_PENALTY } from './ledger';
import type { Action, Ctx, Deal, LedgerEntry, SideEffect } from './types';

function makeCtx(): Ctx {
  let n = 0;
  return {
    now: 1_700_000_000_000,
    newTxnId: () => `tx${n++}`,
    newCode: () => ({ code: '1234', hash: 'h:1234' }),
    verifyCode: (hash, code) => hash === `h:${code}`,
  };
}

const newDeal = (amountCents = 300_00): Deal =>
  createDeal({ id: 'd1', buyerId: 'maya', sellerId: 'sam', useCase: 'marketplace', itemDescription: 'iPhone 12', amountCents });

/** Apply a sequence, asserting each step commits; collect ledger + effects. */
function drive(deal: Deal, ctx: Ctx, actions: Action[]) {
  let d = deal;
  const ledger: LedgerEntry[] = [];
  const effects: SideEffect[] = [];
  for (const a of actions) {
    const r = applyAction(d, a, ctx);
    if (!r.ok) throw new Error(`unexpected reject on ${a.type}: ${r.reason}`);
    d = r.deal;
    ledger.push(...r.ledger);
    effects.push(...r.effects);
  }
  return { deal: d, ledger, effects };
}

const HAPPY: Action[] = [
  { type: 'ACCEPT_TERMS' },
  { type: 'FUND' },
  { type: 'POST_STAKE' },
  { type: 'HEAD_OUT', actor: 'buyer' },
  { type: 'ARRIVE', party: 'buyer' },
  { type: 'ARRIVE', party: 'seller' },
  { type: 'REVEAL_CODE' },
  { type: 'ENTER_CODE', code: '1234' },
  { type: 'CONFIRM_RECEIVED' },
];

describe('happy path + money conservation', () => {
  it('drives DRAFT → RELEASED, ledger conserves, fee splits per tier', () => {
    const ctx = makeCtx();
    const { deal, ledger, effects } = drive(newDeal(300_00), ctx, HAPPY);

    expect(deal.state).toBe('RELEASED');
    expect(balanced(ledger)).toBe(true); // every txn sums to 0 → total conserved
    expect(balanceOf(ledger, escrowAcct('d1'))).toBe(0); // escrow fully drained

    // $300 deal: fee tier = $4/side, commitment $5/side
    expect(balanceOf(ledger, bankAcct('sam'))).toBe(300_00 - 4_00); // seller net +$296.00
    expect(balanceOf(ledger, bankAcct('maya'))).toBe(-(300_00 + 4_00)); // buyer net -$304.00
    expect(balanceOf(ledger, PLATFORM_FEES)).toBe(2 * 4_00); // $8 (both sides)

    // whole-system net is zero
    const total = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(0);

    expect(effects).toContainEqual({ type: 'deal_completed', userIds: ['maya', 'sam'] });
    expect(deal.releaseCodeHash).toBe('h:1234');
  });

  it('co-location gate: AT_MEETUP only after BOTH arrive', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const oneArrived = applyAction(enRoute, { type: 'ARRIVE', party: 'buyer' }, ctx);
    expect(oneArrived.ok && oneArrived.deal.state).toBe('EN_ROUTE'); // not yet
    const bothArrived = applyAction(oneArrived.ok ? oneArrived.deal : enRoute, { type: 'ARRIVE', party: 'seller' }, ctx);
    expect(bothArrived.ok && bothArrived.deal.state).toBe('AT_MEETUP');
  });
});

describe('no-show: commitment goes to the company', () => {
  it('refunds the present party fully and forfeits the no-show $5 to platform', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }, { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'EXPIRE_NO_SHOW', noShow: 'seller' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.state).toBe('EXPIRED_NO_SHOW');
    expect(r.deal.faultParty).toBe('seller');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 4_00 + 5_00); // buyer gets price + prepaid fee + commitment back
    expect(balanceOf(r.ledger, PLATFORM_PENALTY)).toBe(5_00); // seller's $5 commitment to the company
    expect(r.effects).toContainEqual({ type: 'trust_delta', userId: 'sam', delta: -6 });
  });
});

describe('cancel / dispute split', () => {
  it('cancel after funding refunds the buyer, no fee', () => {
    const ctx = makeCtx();
    const funded = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
    const r = applyAction(funded, { type: 'CANCEL', actor: 'buyer' }, ctx);
    expect(r.ok && r.deal.state).toBe('REFUNDED');
    if (!r.ok) return;
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 4_00 + 5_00); // everything back
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0);
  });

  it('backing out AFTER heading out forfeits your commitment (self-declared no-show)', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'CANCEL', actor: 'buyer' }, ctx);
    expect(r.ok && r.deal.state).toBe('EXPIRED_NO_SHOW');
    if (!r.ok) return;
    expect(r.deal.faultParty).toBe('buyer');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, PLATFORM_PENALTY)).toBe(5_00); // buyer's commitment forfeited to the company
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 4_00); // price + fee back, NOT the commitment
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(5_00); // seller's commitment returned
  });

  it('dispute split halves the price, returns commitments, no fee', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const disputed = applyAction(enRoute, { type: 'OPEN_DISPUTE', actor: 'buyer' }, ctx);
    expect(disputed.ok && disputed.deal.state).toBe('DISPUTED');
    if (!disputed.ok) return;
    const r = applyAction(disputed.deal, { type: 'RESOLVE_DISPUTE', outcome: 'split' }, ctx);
    expect(r.ok && r.deal.state).toBe('DISPUTE_RESOLVED');
    if (!r.ok) return;
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(150_00 + 4_00 + 5_00); // half price + prepaid fee + commitment
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(150_00 + 5_00); // half price + commitment
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0);
  });

  it('records positions and emits dispute effects (open → statement → resolve)', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal;

    const opened = applyAction(armed, { type: 'OPEN_DISPUTE', actor: 'buyer' }, ctx);
    expect(opened.ok && opened.deal.state).toBe('DISPUTED');
    if (!opened.ok) return;
    expect(opened.effects).toContainEqual({ type: 'dispute_opened', byUserId: 'maya' });

    const stated = applyAction(opened.deal, { type: 'SUBMIT_POSITION', actor: 'buyer', text: 'item was broken' }, ctx);
    expect(stated.ok).toBe(true);
    if (!stated.ok) return;
    expect(stated.deal.disputePositions).toHaveLength(1);
    expect(stated.effects).toContainEqual({ type: 'dispute_position', userId: 'maya', actor: 'buyer', text: 'item was broken' });
    expect(applyAction(stated.deal, { type: 'SUBMIT_POSITION', actor: 'buyer', text: '  ' }, ctx).ok).toBe(false); // empty rejected

    const resolved = applyAction(stated.deal, { type: 'RESOLVE_DISPUTE', outcome: 'refund' }, ctx);
    expect(resolved.ok && resolved.deal.state).toBe('DISPUTE_RESOLVED');
    if (!resolved.ok) return;
    expect(resolved.effects).toContainEqual({ type: 'dispute_resolved', outcome: 'refund' });
  });

  it('self-service: matching proposals auto-resolve by agreement (no fault); mismatched just record', () => {
    const ctx = makeCtx();
    const disputed = applyAction(drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal, { type: 'OPEN_DISPUTE', actor: 'buyer' }, ctx);
    expect(disputed.ok).toBe(true);
    if (!disputed.ok) return;

    const p1 = applyAction(disputed.deal, { type: 'PROPOSE_RESOLUTION', actor: 'buyer', outcome: 'split' }, ctx);
    expect(p1.ok && p1.deal.state).toBe('DISPUTED'); // one proposal — not resolved
    if (!p1.ok) return;
    expect(p1.deal.disputeProposals.buyer).toBe('split');

    const mismatch = applyAction(p1.deal, { type: 'PROPOSE_RESOLUTION', actor: 'seller', outcome: 'refund' }, ctx);
    expect(mismatch.ok && mismatch.deal.state).toBe('DISPUTED'); // disagree — still open
    if (!mismatch.ok) return;

    const agree = applyAction(mismatch.deal, { type: 'PROPOSE_RESOLUTION', actor: 'seller', outcome: 'split' }, ctx);
    expect(agree.ok && agree.deal.state).toBe('DISPUTE_RESOLVED'); // both say split -> resolved
    if (!agree.ok) return;
    expect(agree.deal.faultParty).toBeNull(); // no fault when mutually agreed
    expect(agree.effects).toContainEqual({ type: 'dispute_resolved', outcome: 'split' });
    expect(balanced(agree.ledger)).toBe(true);
  });
});

// These are the prototype's carryover Group-A bugs — must be impossible here.
describe('guard invariant (carryover bug class)', () => {
  const ctx = makeCtx();

  it('rejects FUND on a DRAFT deal, with NO side-effects', () => {
    const r = applyAction(newDeal(), { type: 'FUND' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('cannot reach RELEASED without passing AT_MEETUP', () => {
    const armed = drive(newDeal(), makeCtx(), [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal;
    const r = applyAction(armed, { type: 'CONFIRM_RECEIVED' }, ctx);
    expect(r.ok).toBe(false); // and so no deal_completed effect is produced
  });

  it('cannot ARRIVE before EN_ROUTE (no no-show-from-ARMED exploit)', () => {
    const armed = drive(newDeal(), makeCtx(), [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal;
    const r = applyAction(armed, { type: 'ARRIVE', party: 'buyer' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects a wrong release code', () => {
    const atMeetup = drive(newDeal(), makeCtx(), [
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' },
      { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }, { type: 'ARRIVE', party: 'seller' },
    ]).deal;
    const r = applyAction(atMeetup, { type: 'ENTER_CODE', code: '0000' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('cannot submit a dispute position outside a dispute', () => {
    const r = applyAction(newDeal(), { type: 'SUBMIT_POSITION', actor: 'buyer', text: 'hi' }, ctx);
    expect(r.ok).toBe(false);
  });
});

describe('release code is minted at reveal (buyer-only delivery)', () => {
  it('POST_STAKE carries NO code; REVEAL_CODE returns the plaintext to the buyer', () => {
    const ctx = makeCtx();
    const funded = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;

    const staked = applyAction(funded, { type: 'POST_STAKE' }, ctx);
    expect(staked.ok).toBe(true);
    if (!staked.ok) return;
    expect(staked.secret).toBeUndefined(); // the seller never receives the code
    expect(staked.deal.releaseCodeHash).toBeNull(); // nothing minted yet

    const atMeetup = drive(staked.deal, ctx, [
      { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }, { type: 'ARRIVE', party: 'seller' },
    ]).deal;
    const revealed = applyAction(atMeetup, { type: 'REVEAL_CODE' }, ctx);
    expect(revealed.ok).toBe(true);
    if (!revealed.ok) return;
    expect(revealed.secret?.releaseCode).toBe('1234'); // buyer gets the plaintext
    expect(revealed.deal.releaseCodeHash).toBe('h:1234'); // only the hash is persisted
  });

  it('ENTER_CODE before the buyer reveals is rejected', () => {
    const ctx = makeCtx();
    const atMeetup = drive(newDeal(), ctx, [
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' },
      { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }, { type: 'ARRIVE', party: 'seller' },
    ]).deal;
    const r = applyAction(atMeetup, { type: 'ENTER_CODE', code: '1234' }, ctx);
    expect(r.ok).toBe(false); // no code exists until REVEAL_CODE mints it
  });
});

describe('CO_LOCATED (server geofence)', () => {
  it('marks both arrived and unlocks AT_MEETUP from EN_ROUTE', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'CO_LOCATED' }, ctx);
    expect(r.ok && r.deal.state).toBe('AT_MEETUP');
    if (!r.ok) return;
    expect(r.deal.buyerArrived && r.deal.sellerArrived).toBe(true);
  });

  it('rejects CO_LOCATED outside EN_ROUTE', () => {
    const r = applyAction(newDeal(), { type: 'CO_LOCATED' }, makeCtx());
    expect(r.ok).toBe(false);
  });
});

describe('HEAD_OUT presence (who is heading over)', () => {
  it('first head-out moves to EN_ROUTE and flags that party; the other can also head out', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal;

    const r1 = applyAction(armed, { type: 'HEAD_OUT', actor: 'buyer' }, ctx);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.deal.state).toBe('EN_ROUTE');
    expect(r1.deal.buyerHeadedOut).toBe(true);
    expect(r1.deal.sellerHeadedOut).toBe(false);

    const r2 = applyAction(r1.deal, { type: 'HEAD_OUT', actor: 'seller' }, ctx);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.deal.state).toBe('EN_ROUTE'); // no state change on the second
    expect(r2.deal.sellerHeadedOut).toBe(true);
  });
});

describe('meetup spot', () => {
  it('sets the meetup before heading out, rejects empty name and once EN_ROUTE', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'POST_STAKE' }]).deal;
    const r = applyAction(armed, { type: 'SET_MEETUP', actor: 'buyer', name: 'Eastside Police Station', lat: 40.71, lng: -74.01, custom: false }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.meetupName).toBe('Eastside Police Station');
    expect(r.deal.meetupLat).toBe(40.71);
    expect(r.deal.meetupCustom).toBe(false);
    expect(applyAction(armed, { type: 'SET_MEETUP', actor: 'buyer', name: '  ', lat: 0, lng: 0, custom: true }, ctx).ok).toBe(false);
    const enRoute = applyAction(r.deal, { type: 'HEAD_OUT', actor: 'buyer' }, ctx);
    if (!enRoute.ok) return;
    expect(applyAction(enRoute.deal, { type: 'SET_MEETUP', actor: 'buyer', name: 'x', lat: 1, lng: 1, custom: false }, ctx).ok).toBe(false);
  });
});

describe('ratings', () => {
  it('rates a completed deal once, emits a rating effect, rejects double/out-of-range/incomplete', () => {
    const ctx = makeCtx();
    const released = drive(newDeal(), ctx, HAPPY).deal;
    expect(released.state).toBe('RELEASED');

    const r = applyAction(released, { type: 'RATE', actor: 'buyer', stars: 5 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.ratings.buyer).toBe(5);
    expect(r.effects).toContainEqual({ type: 'rating', raterId: 'maya', rateeId: 'sam', stars: 5 });

    expect(applyAction(r.deal, { type: 'RATE', actor: 'buyer', stars: 4 }, ctx).ok).toBe(false); // double
    expect(applyAction(released, { type: 'RATE', actor: 'buyer', stars: 6 }, ctx).ok).toBe(false); // range
    expect(applyAction(newDeal(), { type: 'RATE', actor: 'buyer', stars: 5 }, ctx).ok).toBe(false); // not completed
  });
});
