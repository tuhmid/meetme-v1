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
  PLATFORM_PENALTY,
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
    entry(txn, bankAcct(deal.sellerId), h.amount - fee + h.sellerCommitment, deal.id, 'seller_payout'),
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
    entry(txn, bankAcct(deal.sellerId), h.sellerCommitment, deal.id, 'seller_refund'),
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
    entry(txn, bankAcct(deal.sellerId), sellerHalf + h.sellerCommitment, deal.id, 'seller_split'),
  ]);
}

function noShowLedger(deal: Deal, noShow: Role, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const txn = ctx.newTxnId();
  if (noShow === 'seller') {
    // buyer fully refunded; seller's commitment forfeited to the company
    return nonZero([
      entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
      entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerFee + h.buyerCommitment, deal.id, 'present_refund'),
      entry(txn, PLATFORM_PENALTY, h.sellerCommitment, deal.id, 'no_show_penalty'),
    ]);
  }
  // buyer no-show: price + prepaid fee returns, commitment forfeited; seller refunded
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
    entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerFee, deal.id, 'price_return'),
    entry(txn, bankAcct(deal.sellerId), h.sellerCommitment, deal.id, 'present_refund'),
    entry(txn, PLATFORM_PENALTY, h.buyerCommitment, deal.id, 'no_show_penalty'),
  ]);
}


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
function mutate(deal: Deal, patch: Partial<Deal>, event: DealEvent): ApplyResult {
  return { ok: true, deal: { ...deal, ...patch }, events: [event], ledger: [], effects: [] };
}

/** Shared dispute resolution — used by admin RESOLVE_DISPUTE and by mutual agreement.
 *  When agreed, there's no fault party and no trust penalty. */
function resolveDispute(deal: Deal, outcome: 'release' | 'refund' | 'split', ctx: Ctx, byAgreement: boolean, patchExtra: Partial<Deal> = {}): ApplyResult {
  const fault: Role | null = outcome === 'release' ? 'buyer' : outcome === 'refund' ? 'seller' : null;
  const base = outcome === 'release' ? 'released to seller' : outcome === 'refund' ? 'refunded to buyer' : 'price split 50/50';
  const note = byAgreement ? `Resolved by agreement — ${base}.` : `Resolved: ${base}.`;
  const ledger = outcome === 'release' ? releaseLedger(deal, ctx) : outcome === 'refund' ? refundAllLedger(deal, ctx) : splitLedger(deal, ctx);
  const effects: SideEffect[] = [{ type: 'dispute_resolved', outcome }];
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
      const total = deal.amountCents + deal.feeCentsPerSide + deal.commitmentCents;
      const txn = ctx.newTxnId();
      const ledger = nonZero([
        entry(txn, bankAcct(deal.buyerId), -total, deal.id, 'fund'),
        entry(txn, escrowAcct(deal.id), total, deal.id, 'fund'),
      ]);
      return transition(deal, 'FUNDED', ev(ctx, 'buyer', 'funded', `Funded ${usd(total)} into escrow.`), { ledger });
    }

    case 'POST_STAKE': {
      if (deal.state !== 'FUNDED') return reject(`illegal transition ${deal.state} -> ARMED`);
      const txn = ctx.newTxnId();
      const ledger = nonZero([
        entry(txn, bankAcct(deal.sellerId), -deal.commitmentCents, deal.id, 'stake'),
        entry(txn, escrowAcct(deal.id), deal.commitmentCents, deal.id, 'stake'),
      ]);
      // NB: the release code is NOT minted here. It's generated at REVEAL_CODE (a
      // buyer action) so the plaintext only ever reaches the buyer — the seller
      // learns it in person, which is exactly what proves the handoff happened.
      return transition(deal, 'ARMED', ev(ctx, 'seller', 'staked', `Posted ${usd(deal.commitmentCents)} commitment.`), { ledger });
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
      // flips their flag (no state change).
      const patch: Partial<Deal> = action.actor === 'buyer' ? { buyerHeadedOut: true } : { sellerHeadedOut: true };
      const event = ev(ctx, action.actor, 'heading_out', `${action.actor} is heading to the meetup.`);
      if (deal.state === 'ARMED') return transition({ ...deal, ...patch }, 'EN_ROUTE', event, { patch });
      if (deal.state === 'EN_ROUTE') return mutate(deal, patch, event);
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
      const effects: SideEffect[] = [{ type: 'deal_completed', userIds: [deal.buyerId, deal.sellerId] }];
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
      // Once you've headed out, backing out is a no-show: you forfeit your commitment,
      // the other side is made whole (same as EXPIRE_NO_SHOW, but self-declared).
      if (deal.state === 'EN_ROUTE') {
        const note = `${action.actor} backed out after heading out and forfeited their commitment.`;
        return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, action.actor, 'backed_out', note), {
          ledger: noShowLedger(deal, action.actor, ctx),
          effects: [{ type: 'trust_delta', userId: userId(deal, action.actor), delta: -6 }],
          patch: { faultParty: action.actor, resolutionNote: note },
        });
      }
      return reject(`cannot cancel from ${deal.state}`);
    }

    case 'EXPIRE_NO_SHOW': {
      const present = otherRole(action.noShow);
      const note = `${action.noShow} never arrived. ${present} fully refunded; the no-show's commitment went to MeetMe.`;
      return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, 'system', 'no_show', note), {
        ledger: noShowLedger(deal, action.noShow, ctx),
        effects: [{ type: 'trust_delta', userId: userId(deal, action.noShow), delta: -6 }],
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
