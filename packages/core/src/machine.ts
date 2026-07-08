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

import { computeTotalFeeCents, depositForAmount, recoveryFeeForDeposit, splitFee, usd, type Cents } from './money';
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
    totalFeeCents: computeTotalFeeCents(input.amountCents),
    commitmentCents: depositForAmount(input.amountCents),
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
    meetupTime: null,
    meetupProposedBy: null,
    meetupConfirmed: false,
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
  // completion is the ONLY place fees exist: seller's share netted from the
  // payout, buyer's share netted from their deposit (capped so ≥ $1 comes back)
  const h = escrowHeld(deal);
  const { buyerFeeCents, sellerFeeCents } = splitFee(deal.totalFeeCents, deal.commitmentCents);
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'release'),
    entry(txn, bankAcct(deal.sellerId), h.amount - sellerFeeCents, deal.id, 'seller_payout'),
    entry(txn, bankAcct(deal.buyerId), h.buyerDeposit - buyerFeeCents, deal.id, 'buyer_deposit_return'),
    entry(txn, PLATFORM_FEES, buyerFeeCents + sellerFeeCents, deal.id, 'fees'),
  ]);
}

function refundAllLedger(deal: Deal, ctx: Ctx): LedgerEntry[] {
  const h = escrowHeld(deal);
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'refund'),
    entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerDeposit, deal.id, 'buyer_refund'),
  ]);
}

function splitLedger(deal: Deal, ctx: Ctx): LedgerEntry[] {
  // a split is a no-fault outcome: price 50/50, both deposits back whole, no fees
  const h = escrowHeld(deal);
  const buyerHalf = Math.floor(h.amount / 2);
  const sellerHalf = h.amount - buyerHalf;
  const txn = ctx.newTxnId();
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'split'),
    entry(txn, bankAcct(deal.buyerId), buyerHalf + h.buyerDeposit, deal.id, 'buyer_split'),
    entry(txn, bankAcct(deal.sellerId), sellerHalf, deal.id, 'seller_split'),
  ]);
}

function noShowLedger(deal: Deal, noShow: Role, ctx: Ctx): LedgerEntry[] {
  // The flake's deposit compensates the stood-up party (80%); MeetMe keeps a 20%
  // recovery fee (a forfeited deal earns no platform fee). No item fee is charged.
  const h = escrowHeld(deal);
  const recovery = recoveryFeeForDeposit(deal.commitmentCents);
  const comp = deal.commitmentCents - recovery; // 80% to the stood-up party
  const txn = ctx.newTxnId();
  if (noShow === 'seller') {
    // buyer fully refunded from escrow (price + their deposit); the seller's deposit
    // is collected off their card — 80% routed to the buyer, 20% to platform fees. The
    // capture is its own zero-sum txn (that money was never in escrow).
    const capture = ctx.newTxnId();
    return nonZero([
      entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
      entry(txn, bankAcct(deal.buyerId), h.amount + h.buyerDeposit, deal.id, 'present_refund'),
      entry(capture, bankAcct(deal.sellerId), -deal.commitmentCents, deal.id, 'deposit_capture'),
      entry(capture, bankAcct(deal.buyerId), comp, deal.id, 'stood_up_compensation'),
      entry(capture, PLATFORM_FEES, recovery, deal.id, 'no_show_recovery_fee'),
    ]);
  }
  // buyer no-show: the price returns; the buyer's escrowed deposit is split 80% to the
  // stood-up seller, 20% to platform fees.
  return nonZero([
    entry(txn, escrowAcct(deal.id), -heldTotal(h), deal.id, 'no_show'),
    entry(txn, bankAcct(deal.buyerId), h.amount, deal.id, 'price_return'),
    entry(txn, bankAcct(deal.sellerId), comp, deal.id, 'stood_up_compensation'),
    entry(txn, PLATFORM_FEES, recovery, deal.id, 'no_show_recovery_fee'),
  ]);
}

/** Trust + rail effects for a no-show / back-out after heading out. Seller fault
 *  captures their $5 deposit hold (to the buyer); buyer fault releases any seller hold. */
function faultEffects(deal: Deal, atFault: Role): SideEffect[] {
  const effects: SideEffect[] = [{ type: 'trust_delta', userId: userId(deal, atFault), delta: -6 }];
  if (atFault === 'seller') effects.push({ type: 'capture_seller_commitment', toUserId: deal.buyerId, amountCents: deal.commitmentCents });
  else effects.push(...holdRelease(deal));
  return effects;
}

/** Release the seller's commitment hold on any non-capture ending. A hold exists once
 *  the seller heads out (ASAP) OR confirms a scheduled meetup (placed at CONFIRM_MEETUP).
 *  The server no-ops this if no hold was actually placed (it guards on sellerHoldId). */
const holdRelease = (deal: Deal): SideEffect[] =>
  deal.sellerHeadedOut || (deal.meetupConfirmed && deal.meetupTime != null) ? [{ type: 'release_seller_hold' }] : [];


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
  const base = outcome === 'release' ? 'released to seller' : outcome === 'refund' ? 'refunded to buyer' : 'price split 50/50, deposits returned';
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
      // Buyer escrows price + their $5 deposit; NO fee is prepaid (fees are netted
      // at release). The seller's deposit is a card hold placed at HEAD_OUT.
      const total = deal.amountCents + deal.commitmentCents;
      const txn = ctx.newTxnId();
      const ledger = nonZero([
        entry(txn, bankAcct(deal.buyerId), -total, deal.id, 'fund'),
        entry(txn, escrowAcct(deal.id), total, deal.id, 'fund'),
      ]);
      return transition(deal, 'ARMED', ev(ctx, 'buyer', 'funded', `Funded ${usd(total)} into escrow (price + ${usd(deal.commitmentCents)} deposit) — deal armed; no seller stake needed.`), { ledger });
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

    case 'PROPOSE_MEETUP': {
      // Propose where + when (time null = ASAP). Needs the other side to CONFIRM before
      // it's locked — so a forfeit can only ever run against a time both accepted.
      if (!['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state)) return reject(`cannot arrange the meetup from ${deal.state}`);
      if (!action.name.trim()) return reject('meetup name required');
      if (action.time != null && action.time <= ctx.now) return reject('meetup time must be in the future');
      const when = action.time == null ? ' — meet ASAP' : '';
      return mutate(
        deal,
        {
          meetupName: action.name, meetupLat: action.lat, meetupLng: action.lng, meetupCustom: action.custom,
          meetupTime: action.time, meetupProposedBy: action.actor, meetupConfirmed: false,
        },
        ev(ctx, action.actor, 'meetup_proposed', `${action.actor} proposed ${action.name}${action.custom ? ' (custom spot)' : ''}${when}.`)
      );
    }

    case 'CONFIRM_MEETUP': {
      if (!['DRAFT', 'AGREED', 'FUNDED', 'ARMED'].includes(deal.state)) return reject(`cannot confirm the meetup from ${deal.state}`);
      if (!deal.meetupName || deal.meetupProposedBy === null) return reject('no meetup has been proposed yet');
      if (action.actor === deal.meetupProposedBy) return reject('you proposed this meetup — the other person confirms it');
      // A SCHEDULED deal places the seller's $5 hold now (their commitment to the time)
      // so the deposit exists by then; ASAP places it at head-out instead.
      const scheduled = deal.meetupTime != null;
      const effects: SideEffect[] = scheduled && !deal.sellerHoldId
        ? [{ type: 'hold_seller_commitment', sellerId: deal.sellerId, amountCents: deal.commitmentCents }]
        : [];
      return mutate(
        deal,
        { meetupConfirmed: true },
        ev(ctx, action.actor, 'meetup_confirmed', `Meetup confirmed: ${deal.meetupName}${scheduled ? '' : ' — ASAP'}.`),
        effects
      );
    }

    case 'HEAD_OUT': {
      // Track WHO headed out so the other phone can show "they're heading over".
      // First head-out moves ARMED -> EN_ROUTE; the second party heading out just
      // flips their flag (no state change). The seller's FIRST head-out places the
      // $5 deposit hold on their card — captured only if they then no-show/back out.
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
          effects: holdRelease(deal), // scheduled deals hold at confirm — let it go
        });
      }
      if (deal.state === 'EN_ROUTE') {
        // You only forfeit if the OTHER side also committed to travel (headed out). If
        // they never headed out (ghosted you), backing out is a no-fault full refund —
        // you can't be forfeited against someone who never committed.
        const otherHeadedOut = action.actor === 'buyer' ? deal.sellerHeadedOut : deal.buyerHeadedOut;
        if (!otherHeadedOut) {
          const note = `${action.actor} backed out — the other person never headed out, so everyone was refunded in full.`;
          return transition(deal, 'REFUNDED', ev(ctx, action.actor, 'cancelled', note), {
            ledger: refundAllLedger(deal, ctx),
            effects: holdRelease(deal),
            patch: { resolutionNote: note },
          });
        }
        // both headed out → self-declared no-show: you forfeit your deposit to the other side.
        const note = `${action.actor} backed out after heading out and forfeited their ${usd(deal.commitmentCents)} deposit to the other party.`;
        return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, action.actor, 'backed_out', note), {
          ledger: noShowLedger(deal, action.actor, ctx),
          effects: faultEffects(deal, action.actor),
          patch: { faultParty: action.actor, resolutionNote: note },
        });
      }
      return reject(`cannot cancel from ${deal.state}`);
    }

    case 'EXPIRE_NO_SHOW': {
      if (action.noShow === 'both') {
        // Neither showed by the agreed time — no fault, no fee, everyone made whole.
        const note = 'Neither party arrived by the meetup time — everyone refunded in full.';
        return transition(deal, 'EXPIRED_NO_SHOW', ev(ctx, 'system', 'no_show', note), {
          ledger: refundAllLedger(deal, ctx),
          effects: deal.sellerHoldId ? [{ type: 'release_seller_hold' }] : [],
          patch: { faultParty: null, resolutionNote: note },
        });
      }
      const present = otherRole(action.noShow);
      const recovery = recoveryFeeForDeposit(deal.commitmentCents);
      const note = `${action.noShow} never arrived. ${present} fully refunded; ${usd(deal.commitmentCents - recovery)} of the no-show's ${usd(deal.commitmentCents)} deposit went to the ${present} (MeetMe kept a ${usd(recovery)} recovery fee).`;
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
