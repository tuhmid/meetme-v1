// ---------------------------------------------------------------------------
// The machine: ONE pure, guarded, atomic transition function.
//
//   applyAction(deal, action, ctx) -> { ok:false, reason } | { ok:true, ... }
//
// A rejected action returns the rejection and changes NOTHING (no partial
// side-effects — the prototype's "side-effects after a rejected transition" bug
// is impossible here). The result DESCRIBES the changes (next deal, events,
// double-entry ledger legs, user side-effects); the server applies them inside
// one DB transaction. Pure + deterministic (all time/ids/codes come from ctx).
// ---------------------------------------------------------------------------

import { computeCommitmentCents, computeFeeCents, usd, type Cents } from './money';
import { canTransition, type DealState } from './states';
import {
  PLATFORM_FEES,
  bankAcct,
  entry,
  escrowAcct,
  escrowHeld,
  heldTotal,
  nonZero,
} from './ledger';
import type { Action, ApplyResult, Ctx, Deal, DealEvent, LedgerEntry, Role, SideEffect, UseCase } from './types';

const otherRole = (r: Role): Role => (r === 'buyer' ? 'seller' : 'buyer');
const reject = (reason: string): ApplyResult => ({ ok: false, reason });
const userId = (deal: Deal, r: Role): string => (r === 'buyer' ? deal.buyerId : deal.sellerId);

/** Build a DRAFT deal. IDs are supplied by the caller (server) — never minted from a module counter. */
export function createDeal(input: {
  id: string;
  buyerId: string;
  sellerId: string;
  useCase: UseCase;
  itemDescription: string;
  amountCents: Cents;
}): Deal {
  return {
    id: input.id,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    useCase: input.useCase,
    itemDescription: input.itemDescription,
    amountCents: input.amountCents,
    feeCentsPerSide: computeFeeCents(input.amountCents),
    commitmentCents: computeCommitmentCents(input.amountCents),
    state: 'DRAFT',
    releaseCodeHash: null,
    codeRevealed: false,
    buyerHeadedOut: false,
    sellerHeadedOut: false,
    buyerArrived: false,
    sellerArrived: false,
    meetupName: null,
    meetupLat: null,
    meetupLng: null,
    meetupCustom: false,
    sellerHoldId: null,
    faultParty: null,
    resolutionNote: null,
    disputePositions: [],
    disputeProposals: {},
    ratings: {},
  };
}

// --- ledger builders (each returns balanced, non-zero legs) ----------------

function releaseLedger(deal: Deal, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const fee = deal.feeCentsPerSide; // seller's fee, netted from payout
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'release'),
    entry(txn, bankAcct(deal.sellerId), h.amount - fee, deal.id, 'seller_payout'),
    entry(txn, bankAcct(deal.buyerId), h.buyerCommitment, deal.id, 'buyer_commitment_return'),
    entry(txn, PLATFORM_FEES, h.buyerFee + fee, deal.id, 'fees'),
  ]);
}

function refundAllLedger(deal: Deal, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'refund'),
    entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerFee + h.buyerCommitment, deal.id, 'buyer_refund'),
  ]);
}

function splitLedger(deal: Deal, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const buyerHalf = Math.floor(h.amount / 2);
  const sellerHalf = h.amount - buyerHalf;
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'split'),
    entry(txn, bankAcct(deal.buyerId), buyerHalf + h.buyerFee + h.buyerCommitment, deal.id, 'buyer_split'),
    entry(txn, bankAcct(deal.sellerId), sellerHalf, deal.id, 'seller_split'),
  ]);
}

function noShowLedger(deal: Deal, noShow: Role, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const txn = ctx.newTxnId();
  if (noShow === 'seller') {
    // buyer fully refunded from escrow; the seller's commitment is collected off
    // their card and routed to the buyer. The capture is its own zero-sum txn —
    // that money was never in escrow, it moves seller bank -> buyer bank.
    const capture = ctx.newTxnId();
    return nonZero([
      entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
      entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerFee + h.buyerCommitment, deal.id, 'present_refund'),
      entry(capture, bankAcct(deal.sellerId), -deal.commitmentCents, deal.id, 'commitment_capture'),
      entry(capture, bankAcct(deal.buyerId), deal.commitmentCents, deal.id, 'stood_up_compensation'),
    ]);
  }
  // buyer no-show: price + prepaid fee return; the buyer's escrowed commitment
  // goes to the stood-up seller, not the company
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
    entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerFee, deal.id, 'price_return'),
    entry(txn, bankAcct(deal.sellerId), h.buyerCommitment, deal.id, 'stood_up_compensation'),
  ]);
}

/** Trust + rail effects for a no-show / back-out after heading out. Seller fault
 *  captures their card hold (to the buyer); buyer fault releases any seller hold. */
function faultEffects(deal: Deal, atFault: Role): SideEffect[] {
  const effects: SideEffect[] = [{ type: 'trust_delta', userId: userId(deal, atFault), delta: -6 }];
  if (atFault === 'seller') effects.push({ type: 'capture_seller_commitment', toUserId: deal.buyerId, amountCents: deal.commitmentCents });
  else effects.push(...holdRelease(deal));
  return effects;
}

/** A hold can exist only once the seller has headed out; release it on any non-capture ending. */
const holdRelease = (deal: Deal): SideEffect[] => (deal.sellerHeadedOut ? [{ type: 'release_seller_hold' }] : []);


// --- helpers to assemble results -------------------------------------------

const ev = (ctx: Ctx, actor: Role | 'system', type: string, note: string): DealEvent => ({ at: ctx.now, actor, type, note });

/** A state transition (guarded). */
function transition(
  deal: Deal,
  to: DealState,
  event: DealEvent,
  extra: { ledger?: LedgerEntry[]; effects?: SideEffect[]; patch?: Partial<Deal>; secret?: { releaseCode: string } } = {}
): ApplyResult {
  if (!canTransition(deal.state, to)) return reject(`illegal transition ${deal.state} -> ${to}`);
  const next: Deal = { ...deal, ...extra.patch, state: to };
  const out: Extract<ApplyResult, { ok: true }> = {
    ok: true,
    deal: next,
    events: [event],
    ledger: extra.ledger ?? [],
    effects: extra.effects ?? [],
  };
  if (extra.secret) out.secret = extra.secret;
  return out;
}

/** A field mutation with NO state change (still guarded on current state). */
function mutate(deal: Deal, patch: Partial<Deal>, event: DealEvent, effects: SideEffect[] = []): ApplyResult {
  return { ok: true, deal: { ...deal, ...patch }, events: [event], ledger: [], effects };
}

/** Shared dispute resolution — used by admin RESOLVE_DISPUTE and by mutual agreement.
 *  When agreed, there's no fault party and no trust penalty. */
function resolveDispute(deal: Deal, outcome: 'release' | 'refund' | 'split', ctx: Ctx, byAgreement: boolean, patchExtra: Partial<Deal> = {}): ApplyResult {
  const fault: Role | null = outcome === 'release' ? 'buyer' : outcome === 'refund' ? 'seller' : null;
  const base = outcome === 'release' ? 'released to seller' : outcome === 'refund' ? 'refunded to buyer' : 'price split 50/50';
  const note = byAgreement ? `Resolved by agreement — ${base}.` : `Resolved: ${base}.`;
  const ledger = outcome === 'release' ? releaseLedger(deal, ctx) : outcome === 'refund' ? refundAllLedger(deal, ctx) : splitLedger(deal, ctx);
  // dispute endings never capture the seller's commitment — any hold is released
  const effects: SideEffect[] = [{ type: 'dispute_resolved', outcome }, ...holdRelease(deal)];
  if (outcome === 'release') effects.push({ type: 'deal_completed', userIds: [deal.buyerId, deal.sellerId] });
  if (fault && !byAgreement) effects.push({ type: 'trust_delta', userId: userId(deal, fault), delta: -8 });
  return transition(deal, 'DISPUTE_RESOLVED', ev(ctx, 'system', 'resolved', note), {
    ledger,
    effects,
    patch: { faultParty: byAgreement ? null : fault, resolutionNote: note, ...patchExtra },
  });
}

// --- the machine ------------------------------------------------------------

export function applyAction(deal: Deal, action: Action, ctx: Ctx): ApplyResult {
  switch (action.type) {
    case 'ACCEPT_TERMS':
      return transition(deal, 'AGREED', ev(ctx, 'seller', 'accepted', 'Terms accepted.'));

    case 'FUND': {
      // The buyer's money arms the deal directly — there is no seller stake turn.
      // The seller's commitment is a card hold placed when they head out (HEAD_OUT).
      const total = deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents;
      const txn = ctx.newTxnId();
      const ledger = nonZero([
        entry(txn, bankAcct(deal.buyerId), -total, deal.id, 'fund'),
        entry(txn, escrowAcct(deal.id), total, deal.id, 'fund'),
      ]);
      return transition(deal, 'ARMED', ev(ctx, 'buyer', 'funded', `Funded ${usd(total)} into escrow — deal armed; no seller stake needed.`), { ledger });
    }

    case 'SET_MEETUP': {
      // Agree on a spot any time before heading out.
      if (!['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state)) return reject(`cannot set the meetup from ${deal.state}`);
      if (!action.name.trim()) return reject('meetup name required');
      return mutate(
        deal,
        { meetupName: action.name, meetupLat: action.lat, meetupLng: action.lng, meetupCustom: action.custom },
        ev(ctx, action.actor, 'meetup_set', `Meetup set: ${action.name}${action.custom ? ' (custom spot)' : ''}.`)
      );
    }

    case 'HEAD_OUT': {
      // Track WHO headed out so the other phone can show "they're heading over".
      // First head-out moves ARMED -> EN_ROUTE; the second party heading out just
      // flips their flag (no state change). The seller's FIRST head-out places the
      // commitment hold on their card — captured only if they then no-show/back out.
      const patch: Partial<Deal> = action.actor === 'buyer' ? { buyerHeadedOut: true } : { sellerHeadedOut: true };
      const event = ev(ctx, action.actor, 'heading_out', `${action.actor} is heading to the meetup.`);
      const effects: SideEffect[] =
        action.actor === 'seller' && !deal.sellerHeadedOut
          ? [{ type: 'hold_seller_commitment', sellerId: deal.sellerId, amountCents: deal.commitmentCents }]
          : [];
      if (deal.state === 'ARMED') return transition({ ...deal, ...patch }, 'EN_ROUTE', event, { patch, effects });
      if (deal.state === 'EN_ROUTE') return mutate(deal, patch, event, effects);
      return reject(`cannot head out from ${deal.state}`);
    }

    case 'ARRIVE': {
      if (deal.state !== 'EN_ROUTE') return reject(`cannot arrive from ${deal.state}`);
      const patch: Partial<Deal> = action.party === 'buyer' ? { buyerArrived: true } : { sellerArrived: true };
      const both = (action.party === 'buyer' || deal.buyerArrived) && (action.party === 'seller' || deal.sellerArrived);
      const arrivedEvent = ev(ctx, action.party, 'arrived', `${action.party} checked in at the spot.`);
      if (both) {
        // co-location gate: both present -> AT_MEETUP
        return transition({ ...deal, ...patch }, 'AT_MEETUP', ev(ctx, 'system', 'at_meetup', 'Both parties are here. Handoff unlocked.'), {
          patch,
        });
      }
      return mutate(deal, patch, arrivedEvent);
    }

    case 'CO_LOCATED': {
      // Server-detected co-location: the two phones came together at the meetup.
      // Marks BOTH present atomically and unlocks the handoff (manual ARRIVE stays
      // as a fallback for weak GPS). System-only (see authz).
      if (deal.state !== 'EN_ROUTE') return reject(`cannot co-locate from ${deal.state}`);
      const patch: Partial<Deal> = { buyerArrived: true, sellerArrived: true };
      return transition({ ...deal, ...patch }, 'AT_MEETUP', ev(ctx, 'system', 'at_meetup', 'Both phones are at the spot. Handoff unlocked.'), { patch });
    }

    case 'REVEAL_CODE': {
      if (deal.state !== 'AT_MEETUP') return reject(`cannot reveal code from ${deal.state}`);
      // Mint the code now and hand the plaintext back to the buyer ONLY (via the
      // `secret` channel). We persist just the hash — never the plaintext. Calling
      // this again re-mints (latest hash wins); the buyer reads the code currently
      // on their screen to the seller.
      const { code, hash } = ctx.newCode();
      return {
        ok: true,
        deal: { ...deal, codeRevealed: true, releaseCodeHash: hash },
        events: [ev(ctx, 'buyer', 'code_revealed', 'Buyer revealed the release code.')],
        ledger: [],
        effects: [],
        secret: { releaseCode: code },
      };
    }

    case 'ENTER_CODE': {
      if (deal.state !== 'AT_MEETUP') return reject(`cannot enter code from ${deal.state}`);
      if (!deal.releaseCodeHash) return reject('buyer has not revealed the release code yet');
      if (!ctx.verifyCode(deal.releaseCodeHash, action.code)) return reject('release code does not match');
      return transition(deal, 'CONFIRMING', ev(ctx, 'seller', 'code_entered', 'Correct release code entered.'));
    }

    case 'CONFIRM_RECEIVED':
    case 'AUTO_RELEASE': {
      const auto = action.type === 'AUTO_RELEASE';
      const effects: SideEffect[] = [{ type: 'deal_completed', userIds: [deal.buyerId, deal.sellerId] }, ...holdRelease(deal)];
      return transition(deal, 'RELEASED', ev(ctx, auto ? 'system' : 'buyer', auto ? 'auto_released' : 'released', auto ? 'Auto-released after the confirm window.' : 'Handoff confirmed; funds released.'), {
        ledger: releaseLedger(deal, ctx),
        effects,
      });
    }

    case 'OPEN_DISPUTE':
      return transition(deal, 'DISPUTED', ev(ctx, action.actor, 'disputed', `${action.actor} opened a dispute. Funds frozen.`), {
        effects: [{ type: 'dispute_opened', byUserId: userId(deal, action.actor) }],
      });

    case 'SUBMIT_POSITION': {
      if (deal.state !== 'DISPUTED') return reject(`cannot submit a position from ${deal.state}`);
      if (!action.text.trim()) return reject('statement cannot be empty');
      const position = { actor: action.actor, text: action.text, at: ctx.now };
      return {
        ok: true,
        deal: { ...deal, disputePositions: [...deal.disputePositions, position] },
        events: [ev(ctx, action.actor, 'dispute_statement', `${action.actor} submitted their account.`)],
        ledger: [],
        effects: [{ type: 'dispute_position', userId: userId(deal, action.actor), actor: action.actor, text: action.text }],
      };
    }

    case 'RESOLVE_DISPUTE':
      return resolveDispute(deal, action.outcome, ctx, false);

    case 'PROPOSE_RESOLUTION': {
      if (deal.state !== 'DISPUTED') return reject(`cannot propose a resolution from ${deal.state}`);
      const other = otherRole(action.actor);
      const proposals = { ...deal.disputeProposals, [action.actor]: action.outcome };
      // both sides proposed the SAME outcome -> resolve now, by agreement (no fault)
      if (deal.disputeProposals[other] === action.outcome) {
        return resolveDispute({ ...deal, disputeProposals: proposals }, action.outcome, ctx, true, { disputeProposals: proposals });
      }
      const label = action.outcome === 'release' ? 'release to the seller' : action.outcome === 'refund' ? 'refund the buyer' : 'split 50/50';
      return {
        ok: true,
        deal: { ...deal, disputeProposals: proposals },
        events: [ev(ctx, action.actor, 'proposed', `${action.actor} proposed to ${label}.`)],
        ledger: [],
        effects: [{ type: 'dispute_proposal', actor: action.actor, outcome: action.outcome }],
      };
    }

    case 'CANCEL': {
      // Before anyone heads out, backing out is FREE and fully refunded — plans change.
      if (deal.state === 'DRAFT' || deal.state === 'AGREED') {
        return transition(deal, 'CANCELLED', ev(ctx, action.actor, 'cancelled', `${action.actor} cancelled the deal.`));
      }
      if (deal.state === 'FUNDED' || deal.state === 'ARMED') {
        return transition(deal, 'REFUNDED', ev(ctx, action.actor, 'cancelled', `${action.actor} cancelled before heading out — everyone refunded in full.`), {
          ledger: refundAllLedger(deal, ctx),
        });
      }
      // Once you've headed out, backing out is a no-show: you forfeit your commitment
      // to the other side, who is made whole (same as EXPIRE_NO_SHOW, but self-declared).
      if (deal.state === 'EN_ROUTE') {
        const note = `${action.actor} backed out after heading out and forfeited their commitment to the other party.`;
        return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, action.actor, 'backed_out', note), {
          ledger: noShowLedger(deal, action.actor, ctx),
          effects: faultEffects(deal, action.actor),
          patch: { faultParty: action.actor, resolutionNote: note },
        });
      }
      return reject(`cannot cancel from ${deal.state}`);
    }

    case 'EXPIRE_NO_SHOW': {
      const present = otherRole(action.noShow);
      const note = `${action.noShow} never arrived. ${present} fully refunded; the no-show's commitment went to the ${present}.`;
      return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, 'system', 'no_show', note), {
        ledger: noShowLedger(deal, action.noShow, ctx),
        effects: faultEffects(deal, action.noShow),
        patch: { faultParty: action.noShow, resolutionNote: note },
      });
    }

    case 'RATE': {
      if (deal.state !== 'RELEASED' && deal.state !== 'DISPUTE_RESOLVED') return reject('can only rate a completed deal');
      if (action.stars < 1 || action.stars > 5) return reject('stars must be 1-5');
      if (deal.ratings[action.actor] !== undefined) return reject('already rated');
      return {
        ok: true,
        deal: { ...deal, ratings: { ...deal.ratings, [action.actor]: action.stars } },
        events: [ev(ctx, action.actor, 'rated', `${action.actor} left ${action.stars} stars.`)],
        ledger: [],
        effects: [{ type: 'rating', raterId: userId(deal, action.actor), rateeId: userId(deal, otherRole(action.actor)), stars: action.stars }],
      };
    }

    default:
      return reject('unknown action');
  }
}
