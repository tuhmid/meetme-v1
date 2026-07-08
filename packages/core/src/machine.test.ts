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
  { type: 'HEAD_OUT', actor: 'buyer' },
  { type: 'HEAD_OUT', actor: 'seller' },
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

    // $300 deal: $12 total fee → buyer $4 (capped) / seller $8; deposit flat $5
    expect(balanceOf(ledger, bankAcct('sam'))).toBe(300_00 - 8_00); // seller net +$292.00
    expect(balanceOf(ledger, bankAcct('maya'))).toBe(-(300_00 + 4_00)); // funded $305, $1 of the deposit back
    expect(balanceOf(ledger, PLATFORM_FEES)).toBe(12_00); // the whole fee, both shares

    // whole-system net is zero
    const total = ledger.reduce((s, e) => s + e.amountCents, 0);
    expect(total).toBe(0);

    // no seller deposit leg anywhere — their deposit was only ever a card hold
    expect(ledger.some((e) => e.memo === 'stake' || e.memo === 'seller_refund')).toBe(false);
    expect(effects).toContainEqual({ type: 'deal_completed', userIds: ['maya', 'sam'] });
    expect(effects).toContainEqual({ type: 'release_seller_hold' }); // seller headed out -> hold existed -> released
    expect(deal.releaseCodeHash).toBe('h:1234');
  });

  it('FUND arms the deal directly — no seller stake turn', () => {
    const ctx = makeCtx();
    const { deal, ledger } = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]);
    expect(deal.state).toBe('ARMED');
    expect(balanceOf(ledger, bankAcct('maya'))).toBe(-(300_00 + 5_00)); // price + $5 deposit, no fee leg
    expect(balanceOf(ledger, escrowAcct('d1'))).toBe(300_00 + 5_00);
    expect(balanceOf(ledger, bankAcct('sam'))).toBe(0); // seller pays nothing upfront
  });

  it('co-location gate: AT_MEETUP only after BOTH arrive', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const oneArrived = applyAction(enRoute, { type: 'ARRIVE', party: 'buyer' }, ctx);
    expect(oneArrived.ok && oneArrived.deal.state).toBe('EN_ROUTE'); // not yet
    const bothArrived = applyAction(oneArrived.ok ? oneArrived.deal : enRoute, { type: 'ARRIVE', party: 'seller' }, ctx);
    expect(bothArrived.ok && bothArrived.deal.state).toBe('AT_MEETUP');
  });
});

describe('no-show: the deposit goes to the stood-up party', () => {
  it('seller no-show: buyer fully refunded AND collects the seller deposit off their card', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'EXPIRE_NO_SHOW', noShow: 'seller' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.state).toBe('EXPIRED_NO_SHOW');
    expect(r.deal.faultParty).toBe('seller');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 5_00 + 4_00); // full refund + $4 of the seller's captured deposit
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(-5_00); // whole $5 collected off the seller's card
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(1_00); // $1 recovery fee
    expect(balanceOf(r.ledger, PLATFORM_PENALTY)).toBe(0);
    expect(r.effects).toContainEqual({ type: 'trust_delta', userId: 'sam', delta: -6 });
    expect(r.effects).toContainEqual({ type: 'capture_seller_commitment', toUserId: 'maya', amountCents: 5_00 });
  });

  it('buyer no-show: the buyer deposit pays the stood-up seller, the price returns', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' },
      { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'HEAD_OUT', actor: 'seller' }, { type: 'ARRIVE', party: 'seller' },
    ]).deal;
    const r = applyAction(enRoute, { type: 'EXPIRE_NO_SHOW', noShow: 'buyer' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.faultParty).toBe('buyer');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00); // price back, NOT the deposit
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(4_00); // $4 of the buyer's deposit, to the seller
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(1_00); // $1 recovery fee
    expect(balanceOf(r.ledger, PLATFORM_PENALTY)).toBe(0);
    expect(r.effects).toContainEqual({ type: 'trust_delta', userId: 'maya', delta: -6 });
    expect(r.effects).toContainEqual({ type: 'release_seller_hold' }); // seller headed out; their hold is let go
  });
});

describe('meetup arrangement (propose → confirm)', () => {
  const armed = () => drive(newDeal(300_00), makeCtx(), [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;

  it('propose sets a pending meetup; the OTHER side confirms it (ASAP, no hold at confirm)', () => {
    const ctx = makeCtx();
    const proposed = applyAction(armed(), { type: 'PROPOSE_MEETUP', actor: 'buyer', name: 'Precinct', lat: 1, lng: 2, custom: false, time: null }, ctx);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.deal.meetupProposedBy).toBe('buyer');
    expect(proposed.deal.meetupConfirmed).toBe(false);
    expect(proposed.deal.meetupTime).toBeNull();
    // the proposer cannot confirm their own proposal
    expect(applyAction(proposed.deal, { type: 'CONFIRM_MEETUP', actor: 'buyer' }, ctx).ok).toBe(false);
    const confirmed = applyAction(proposed.deal, { type: 'CONFIRM_MEETUP', actor: 'seller' }, ctx);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.deal.meetupConfirmed).toBe(true);
    expect(confirmed.effects.some((e) => e.type === 'hold_seller_commitment')).toBe(false); // ASAP holds at head-out
  });

  it('a SCHEDULED confirm places the seller commitment hold up front', () => {
    const ctx = makeCtx();
    const proposed = applyAction(armed(), { type: 'PROPOSE_MEETUP', actor: 'seller', name: 'Precinct', lat: 1, lng: 2, custom: false, time: 1_700_000_900_000 }, ctx);
    if (!proposed.ok) return;
    const confirmed = applyAction(proposed.deal, { type: 'CONFIRM_MEETUP', actor: 'buyer' }, ctx);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.deal.meetupTime).toBe(1_700_000_900_000);
    expect(confirmed.effects).toContainEqual({ type: 'hold_seller_commitment', sellerId: 'sam', amountCents: 5_00 });
  });

  it('rescheduling (a new proposal) re-opens confirmation', () => {
    const ctx = makeCtx();
    const p1 = applyAction(armed(), { type: 'PROPOSE_MEETUP', actor: 'buyer', name: 'A', lat: 1, lng: 2, custom: false, time: null }, ctx);
    if (!p1.ok) return;
    const c1 = applyAction(p1.deal, { type: 'CONFIRM_MEETUP', actor: 'seller' }, ctx);
    if (!c1.ok) return;
    expect(c1.deal.meetupConfirmed).toBe(true);
    const p2 = applyAction(c1.deal, { type: 'PROPOSE_MEETUP', actor: 'seller', name: 'B', lat: 3, lng: 4, custom: false, time: null }, ctx);
    if (!p2.ok) return;
    expect(p2.deal.meetupConfirmed).toBe(false); // reschedule reopens
    expect(p2.deal.meetupName).toBe('B');
  });

  it('rejects a proposed meetup time in the past (server-side guard)', () => {
    const ctx = makeCtx();
    const past = applyAction(armed(), { type: 'PROPOSE_MEETUP', actor: 'buyer', name: 'X', lat: 1, lng: 2, custom: false, time: ctx.now - 60_000 }, ctx);
    expect(past.ok).toBe(false);
    const future = applyAction(armed(), { type: 'PROPOSE_MEETUP', actor: 'buyer', name: 'X', lat: 1, lng: 2, custom: false, time: ctx.now + 60 * 60_000 }, ctx);
    expect(future.ok).toBe(true);
  });
});

describe('mutual no-show (neither showed by the agreed time)', () => {
  it('refunds both in full — no fault, no recovery fee', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'EXPIRE_NO_SHOW', noShow: 'both' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deal.state).toBe('EXPIRED_NO_SHOW');
    expect(r.deal.faultParty).toBeNull();
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 5_00); // buyer fully refunded
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0); // no fee on a mutual flake
  });
});

describe('cancel / dispute split', () => {
  it('cancel after funding refunds the buyer, no fee', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
    const r = applyAction(armed, { type: 'CANCEL', actor: 'buyer' }, ctx);
    expect(r.ok && r.deal.state).toBe('REFUNDED');
    if (!r.ok) return;
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 5_00); // everything back
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0);
  });

  it('backing out when the other side never headed out is a no-fault full refund', () => {
    const ctx = makeCtx();
    // buyer headed out, seller ghosted (never headed out) — buyer cancels
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'CANCEL', actor: 'buyer' }, ctx);
    expect(r.ok && r.deal.state).toBe('REFUNDED');
    if (!r.ok) return;
    expect(r.deal.faultParty).toBeNull(); // no forfeit — the seller never committed to travel
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 5_00); // buyer gets everything back
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0);
  });

  it('buyer backing out after BOTH headed out forfeits their deposit to the seller', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'HEAD_OUT', actor: 'seller' }]).deal;
    const r = applyAction(enRoute, { type: 'CANCEL', actor: 'buyer' }, ctx);
    expect(r.ok && r.deal.state).toBe('EXPIRED_NO_SHOW');
    if (!r.ok) return;
    expect(r.deal.faultParty).toBe('buyer');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(1_00); // $1 recovery fee
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00); // price back, NOT the deposit
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(4_00); // $4 of the forfeited deposit to the stood-up seller
  });

  it('seller backing out after BOTH headed out gets their card deposit captured for the buyer', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'seller' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
    const r = applyAction(enRoute, { type: 'CANCEL', actor: 'seller' }, ctx);
    expect(r.ok && r.deal.state).toBe('EXPIRED_NO_SHOW');
    if (!r.ok) return;
    expect(r.deal.faultParty).toBe('seller');
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(300_00 + 5_00 + 4_00); // made whole + $4 compensation
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(-5_00);
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(1_00); // $1 recovery fee
    expect(r.effects).toContainEqual({ type: 'capture_seller_commitment', toUserId: 'maya', amountCents: 5_00 });
  });

  it('dispute split halves the price, returns the buyer deposit, releases the hold, no fee', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'seller' }]).deal;
    const disputed = applyAction(enRoute, { type: 'OPEN_DISPUTE', actor: 'buyer' }, ctx);
    expect(disputed.ok && disputed.deal.state).toBe('DISPUTED');
    if (!disputed.ok) return;
    const r = applyAction(disputed.deal, { type: 'RESOLVE_DISPUTE', outcome: 'split' }, ctx);
    expect(r.ok && r.deal.state).toBe('DISPUTE_RESOLVED');
    if (!r.ok) return;
    expect(balanced(r.ledger)).toBe(true);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(150_00 + 5_00); // half price + the whole deposit
    expect(balanceOf(r.ledger, bankAcct('sam'))).toBe(150_00); // half price (their deposit was never in escrow)
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(0);
    expect(r.effects).toContainEqual({ type: 'release_seller_hold' }); // disputes never capture the hold
  });

  it('records positions and emits dispute effects (open → statement → resolve)', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;

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
    const disputed = applyAction(drive(newDeal(300_00), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal, { type: 'OPEN_DISPUTE', actor: 'buyer' }, ctx);
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
    const armed = drive(newDeal(), makeCtx(), [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
    const r = applyAction(armed, { type: 'CONFIRM_RECEIVED' }, ctx);
    expect(r.ok).toBe(false); // and so no deal_completed effect is produced
  });

  it('cannot ARRIVE before EN_ROUTE (no no-show-from-ARMED exploit)', () => {
    const armed = drive(newDeal(), makeCtx(), [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
    const r = applyAction(armed, { type: 'ARRIVE', party: 'buyer' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects a wrong release code', () => {
    const atMeetup = drive(newDeal(), makeCtx(), [
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' },
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
  it('FUND carries NO code; REVEAL_CODE returns the plaintext to the buyer', () => {
    const ctx = makeCtx();
    const funded = applyAction(drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }]).deal, { type: 'FUND' }, ctx);
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;
    expect(funded.secret).toBeUndefined(); // nobody receives a code at funding
    expect(funded.deal.releaseCodeHash).toBeNull(); // nothing minted yet

    const atMeetup = drive(funded.deal, ctx, [
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
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' },
      { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' }, { type: 'ARRIVE', party: 'seller' },
    ]).deal;
    const r = applyAction(atMeetup, { type: 'ENTER_CODE', code: '1234' }, ctx);
    expect(r.ok).toBe(false); // no code exists until REVEAL_CODE mints it
  });
});

describe('CO_LOCATED (server geofence)', () => {
  it('marks both arrived and unlocks AT_MEETUP from EN_ROUTE', () => {
    const ctx = makeCtx();
    const enRoute = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }]).deal;
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

describe('HEAD_OUT presence + the seller deposit hold', () => {
  it('first head-out moves to EN_ROUTE and flags that party; the other can also head out', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;

    const r1 = applyAction(armed, { type: 'HEAD_OUT', actor: 'buyer' }, ctx);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.deal.state).toBe('EN_ROUTE');
    expect(r1.deal.buyerHeadedOut).toBe(true);
    expect(r1.deal.sellerHeadedOut).toBe(false);
    expect(r1.effects).toEqual([]); // buyer heading out places no hold

    const r2 = applyAction(r1.deal, { type: 'HEAD_OUT', actor: 'seller' }, ctx);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.deal.state).toBe('EN_ROUTE'); // no state change on the second
    expect(r2.deal.sellerHeadedOut).toBe(true);
    // the seller's head-out places the $5 deposit hold on their card
    expect(r2.effects).toContainEqual({ type: 'hold_seller_commitment', sellerId: 'sam', amountCents: 5_00 });

    const again = applyAction(r2.deal, { type: 'HEAD_OUT', actor: 'seller' }, ctx);
    expect(again.ok && again.effects).toEqual([]); // never double-holds
  });

  it('seller heading out FIRST also places the hold (with the EN_ROUTE transition)', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
    const r = applyAction(armed, { type: 'HEAD_OUT', actor: 'seller' }, ctx);
    expect(r.ok && r.deal.state).toBe('EN_ROUTE');
    if (!r.ok) return;
    expect(r.effects).toContainEqual({ type: 'hold_seller_commitment', sellerId: 'sam', amountCents: 5_00 });
  });
});

describe('meetup spot', () => {
  it('sets the meetup before heading out, rejects empty name and once EN_ROUTE', () => {
    const ctx = makeCtx();
    const armed = drive(newDeal(), ctx, [{ type: 'ACCEPT_TERMS' }, { type: 'FUND' }]).deal;
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

// The exact dollars a user would see, end to end — pinned so a fee-table edit
// that shifts real payouts can't slip through as "all tests still pass".
describe('worked examples (whole-deal money)', () => {
  const deal = (amountCents: number): Deal =>
    createDeal({ id: 'd1', buyerId: 'maya', sellerId: 'sam', useCase: 'marketplace', itemDescription: 'thing', amountCents });

  it('$150 deal: fund $155, buyer gets $1 back, seller nets $144, platform $10', () => {
    const ctx = makeCtx();
    const { deal: d, ledger } = drive(deal(150_00), ctx, HAPPY);
    expect(d.state).toBe('RELEASED');

    const fund = ledger.find((e) => e.memo === 'fund' && e.account === escrowAcct('d1'));
    expect(fund?.amountCents).toBe(155_00); // price + $5 deposit, no fee leg

    // total fee $10 → buyer $4 (capped) / seller $6
    expect(ledger.find((e) => e.memo === 'buyer_deposit_return')?.amountCents).toBe(1_00);
    expect(ledger.find((e) => e.memo === 'seller_payout')?.amountCents).toBe(144_00);
    expect(balanceOf(ledger, PLATFORM_FEES)).toBe(10_00);
    expect(ledger.reduce((s, e) => s + e.amountCents, 0)).toBe(0); // zero-sum across the deal
    expect(balanced(ledger)).toBe(true);
  });

  it('$30 deal: fund $35, buyer gets $2.50 back, seller nets $27.50, platform $5', () => {
    const ctx = makeCtx();
    const { ledger } = drive(deal(30_00), ctx, HAPPY);

    const fund = ledger.find((e) => e.memo === 'fund' && e.account === escrowAcct('d1'));
    expect(fund?.amountCents).toBe(35_00);

    // total fee $5 → split $2.50 / $2.50
    expect(ledger.find((e) => e.memo === 'buyer_deposit_return')?.amountCents).toBe(2_50);
    expect(ledger.find((e) => e.memo === 'seller_payout')?.amountCents).toBe(27_50);
    expect(balanceOf(ledger, PLATFORM_FEES)).toBe(5_00);
    expect(ledger.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
  });

  it('$150 seller no-show: buyer made whole ($155 refund + $4 comp), platform keeps a $1 recovery fee', () => {
    const ctx = makeCtx();
    const enRoute = drive(deal(150_00), ctx, [
      { type: 'ACCEPT_TERMS' }, { type: 'FUND' }, { type: 'HEAD_OUT', actor: 'buyer' }, { type: 'ARRIVE', party: 'buyer' },
    ]).deal;
    const r = applyAction(enRoute, { type: 'EXPIRE_NO_SHOW', noShow: 'seller' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.ledger.find((e) => e.memo === 'present_refund')?.amountCents).toBe(155_00);
    expect(r.ledger.find((e) => e.memo === 'stood_up_compensation')?.amountCents).toBe(4_00);
    expect(r.ledger.find((e) => e.memo === 'no_show_recovery_fee')?.amountCents).toBe(1_00);
    expect(balanceOf(r.ledger, bankAcct('maya'))).toBe(159_00); // $155 back + $4 of the seller's $5
    expect(balanceOf(r.ledger, PLATFORM_FEES)).toBe(1_00); // $1 recovery fee
    expect(balanceOf(r.ledger, PLATFORM_PENALTY)).toBe(0);
    expect(balanced(r.ledger)).toBe(true);
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
