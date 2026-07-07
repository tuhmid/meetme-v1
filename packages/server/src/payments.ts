import { bankAcct, PLATFORM_PENALTY, type Action, type Deal, type SideEffect } from '@meetme/core';
import { handleAction, type ActionRequest, type HandlerResult } from './handler';
import type { Repo } from './repo';
import type { ServerCtx } from './ctx';
import { RISK_DECLINE_THRESHOLD, type PaymentRail, type TransferDirection } from './rails/rail';

export type ExecResult = HandlerResult | { ok: false; code: 'risk_declined' | 'funding_not_settled'; reason: string };

const RELEASE = new Set<Action['type']>(['CONFIRM_RECEIVED', 'AUTO_RELEASE']);
const MONEY_OUT = new Set<Action['type']>(['CONFIRM_RECEIVED', 'AUTO_RELEASE', 'CANCEL', 'EXPIRE_NO_SHOW', 'RESOLVE_DISPUTE']);

/**
 * Wraps the M1 handler with rail execution:
 *  - FUND: a Signal risk gate, then a funding pull (recorded as a transfer).
 *  - release: BLOCKED until the buyer's funding has SETTLED (the payout-settlement
 *    policy — never pay the seller before the money clears).
 *  - money-out: payouts/refunds are mirrored from the committed ledger's bank
 *    credits, so the rail can never disagree with the accounting.
 */
export async function executeAction(repo: Repo, rail: PaymentRail, req: ActionRequest, ctx: ServerCtx): Promise<ExecResult> {
  if (req.action.type === 'FUND') {
    const rec = await repo.getDeal(req.dealId);
    if (!rec) return { ok: false, code: 'not_found', reason: 'deal not found' };
    const total = rec.deal.amountCents + rec.deal.feeCentsPerSide + rec.deal.commitmentCents;
    const intent = { dealId: req.dealId, userId: rec.deal.buyerId, amountCents: total, idempotencyKey: `fund:${req.dealId}` };

    const risk = await rail.evaluateFundingRisk(intent);
    if (risk !== undefined && risk >= RISK_DECLINE_THRESHOLD) {
      return { ok: false, code: 'risk_declined', reason: `funding declined (ACH-return risk ${risk})` };
    }

    const res = await handleAction(repo, req, ctx);
    if (!res.ok) return res;

    const tr = await rail.initiateFunding(intent);
    await repo.recordTransfer({
      dealId: req.dealId, provider: rail.name, providerRef: tr.transferId, rail: tr.rail,
      direction: 'fund_buyer', amountCents: total, status: tr.status, riskScore: risk ?? null, idempotencyKey: intent.idempotencyKey,
    });
    return res;
  }

  if (RELEASE.has(req.action.type)) {
    const funding = await repo.getFundingTransfer(req.dealId);
    if (!funding || funding.status !== 'settled') {
      return { ok: false, code: 'funding_not_settled', reason: "cannot release before the buyer's funds settle" };
    }
  }

  const res = await handleAction(repo, req, ctx);
  if (!res.ok) return res;

  // seller-commitment card effects first (place/capture/release the hold),
  // then mirror the committed ledger's payouts onto the rail
  await runCommitmentEffects(repo, rail, req.dealId, res.deal, res.effects, ctx);

  if (MONEY_OUT.has(req.action.type)) {
    const deal = (await repo.getDeal(req.dealId))?.deal ?? res.deal;
    let n = 0;
    for (const e of res.ledger) {
      if (!e.account.startsWith('bank:') || e.amountCents <= 0) continue; // only credits leave the system
      const userId = e.account.slice('bank:'.length);
      // credit to the seller = payout; credit to the buyer = refund. Correct across
      // release, dispute splits, no-show, and cancel (not just RELEASE actions).
      const direction: TransferDirection = userId === deal.sellerId ? 'payout_seller' : 'refund_buyer';
      const intent = { dealId: req.dealId, userId, amountCents: e.amountCents, idempotencyKey: `${direction}:${req.dealId}:${n++}` };
      const tr = direction === 'payout_seller' ? await rail.initiatePayout(intent) : await rail.initiateRefund(intent);
      await repo.recordTransfer({
        dealId: req.dealId, provider: rail.name, providerRef: tr.transferId, rail: tr.rail,
        direction, amountCents: e.amountCents, status: tr.status, riskScore: null, idempotencyKey: intent.idempotencyKey,
      });
    }
  }
  return res;
}

/**
 * Drive the seller-commitment card effects on the rail. Runs AFTER the transition
 * committed — the accounting truth is already in the ledger; these calls execute
 * (or clean up) the real-world card movement the ledger describes.
 */
async function runCommitmentEffects(repo: Repo, rail: PaymentRail, dealId: string, deal: Deal, effects: SideEffect[], ctx: ServerCtx): Promise<void> {
  for (const eff of effects) {
    if (eff.type === 'hold_seller_commitment') {
      if (deal.sellerHoldId) continue; // already placed
      const { holdId } = await rail.holdCommitment(eff.sellerId, eff.amountCents);
      await repo.setSellerHold(dealId, holdId);
    } else if (eff.type === 'capture_seller_commitment') {
      // no hold means the seller never headed out — place-and-capture against the card on file
      const holdId = deal.sellerHoldId ?? (await rail.holdCommitment(deal.sellerId, eff.amountCents)).holdId;
      const captured = await rail.captureHold(holdId);
      await repo.setSellerHold(dealId, null);
      if (!captured.ok) await absorbFailedCollection(repo, dealId, deal.sellerId, eff.amountCents, ctx);
    } else if (eff.type === 'release_seller_hold') {
      if (deal.sellerHoldId) {
        await rail.releaseHold(deal.sellerHoldId);
        await repo.setSellerHold(dealId, null);
      }
    }
  }
}

/**
 * Collection failed (empty/prepaid card, dispute): the company absorbs what the
 * wronged party is owed — their payout already went out — and the seller's trust
 * is nuked. FakeRail never fails; a real card rail will.
 */
async function absorbFailedCollection(repo: Repo, dealId: string, sellerId: string, amountCents: number, ctx: ServerCtx): Promise<void> {
  const rec = await repo.getDeal(dealId);
  if (!rec) return;
  const txn = ctx.newTxnId();
  await repo.commit(dealId, rec.version, {
    deal: rec.deal,
    events: [{ at: ctx.now, actor: 'system', type: 'collection_failed', note: "Couldn't collect the seller's commitment — MeetMe covered it." }],
    ledger: [
      { txnId: txn, account: bankAcct(sellerId), amountCents, dealId, memo: 'collection_failed_reversal' },
      { txnId: txn, account: PLATFORM_PENALTY, amountCents: -amountCents, dealId, memo: 'collection_failed_absorbed' },
    ],
    effects: [{ type: 'trust_delta', userId: sellerId, delta: -50 }],
  });
}

/** Settlement hooks — a real rail calls these from a Plaid webhook; the M5 worker polls. */
export const markFundingSettled = (repo: Repo, dealId: string) => repo.setTransferStatus(`fund:${dealId}`, 'settled');
export const markFundingReturned = (repo: Repo, dealId: string) => repo.setTransferStatus(`fund:${dealId}`, 'returned');
