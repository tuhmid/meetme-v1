import type { Action } from '@meetme/core';
import { executeAction, markFundingSettled } from './payments';
import { notifyDealState } from './notify';
import { NoopPushSender, type PushSender } from './pushExpo';
import type { PaymentRail } from './rails/rail';
import type { DealRecord, Repo } from './repo';
import type { ServerCtx } from './ctx';

// The background worker makes deals move on their own — the timers a live product
// needs. It's pure-logic + a thin driver, so it's fully testable with MemoryRepo
// and a controlled clock. Runs periodically (see apps/api/src/worker.ts).

export interface WorkerWindows {
  /** EN_ROUTE, one party arrived, the other absent this long -> the absent party is a no-show. */
  noShowMs: number;
  /** CONFIRMING this long without the buyer confirming -> AUTO_RELEASE. */
  confirmMs: number;
}

export const DEFAULT_WINDOWS: WorkerWindows = {
  noShowMs: 30 * 60_000, // 30 min
  confirmMs: 60 * 60_000, // 60 min
};

/**
 * Pure: the single timed transition (if any) due for this deal right now. Timing
 * is measured from the deal's last write (`updatedAt`), so each arrival/among
 * activity resets the clock — the deadline is against inactivity.
 */
export function dueTransition(rec: DealRecord, now: number, w: WorkerWindows): Action | null {
  const { deal, updatedAt } = rec;
  const age = now - updatedAt;

  if (deal.state === 'EN_ROUTE' && age >= w.noShowMs) {
    if (deal.buyerArrived && !deal.sellerArrived) return { type: 'EXPIRE_NO_SHOW', noShow: 'seller' };
    if (deal.sellerArrived && !deal.buyerArrived) return { type: 'EXPIRE_NO_SHOW', noShow: 'buyer' };
    return null; // neither arrived -> no clear fault; leave for a manual cancel
  }

  if (deal.state === 'CONFIRMING' && age >= w.confirmMs) {
    return { type: 'AUTO_RELEASE' };
  }

  return null;
}

export interface WorkerSummary {
  scanned: number;
  settled: number; // fundings synced to 'settled' this pass
  expired: number; // no-show expirations
  released: number; // auto-releases
}

/**
 * One worker pass:
 *   1. Sync funding settlement from the rail (a Plaid webhook/poll in prod) so the
 *      payout-settlement gate can open.
 *   2. Fire any due timed transition (no-show / auto-release) as a SYSTEM action.
 * Idempotent — safe to run on a short interval.
 */
export async function runWorkerOnce(
  repo: Repo,
  rail: PaymentRail,
  makeCtx: () => ServerCtx,
  opts: { now?: number; windows?: WorkerWindows; push?: PushSender } = {}
): Promise<WorkerSummary> {
  const windows = opts.windows ?? DEFAULT_WINDOWS;
  const now = opts.now ?? Date.now();
  const push = opts.push ?? NoopPushSender;
  const active = await repo.listActiveDeals();
  const summary: WorkerSummary = { scanned: active.length, settled: 0, expired: 0, released: 0 };

  for (const rec of active) {
    // 1) settlement sync
    const funding = await repo.getFundingTransfer(rec.deal.id);
    if (funding && funding.providerRef && funding.status !== 'settled' && funding.status !== 'returned') {
      const status = await rail.getStatus(funding.providerRef);
      if (status === 'settled') {
        await markFundingSettled(repo, rec.deal.id);
        summary.settled++;
      }
    }

    // 2) due timed transition
    const action = dueTransition(rec, now, windows);
    if (!action) continue;
    const r = await executeAction(repo, rail, { dealId: rec.deal.id, action, callerUserId: null, channel: 'system' }, makeCtx());
    if (r.ok) {
      if (action.type === 'EXPIRE_NO_SHOW') summary.expired++;
      else if (action.type === 'AUTO_RELEASE') summary.released++;
      await notifyDealState(repo, push, r.deal);
    }
  }

  return summary;
}
