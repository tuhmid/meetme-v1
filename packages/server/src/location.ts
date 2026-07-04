import { COLOCATION_RADIUS_M, haversineMeters, withinRadius } from '@meetme/core';
import { executeAction } from './payments';
import type { PaymentRail } from './rails/rail';
import type { Repo } from './repo';
import type { ServerCtx } from './ctx';

export type LocationResult =
  | { ok: false; code: 'not_found' | 'forbidden'; reason: string }
  | { ok: true; distanceM: number | null; coLocated: boolean; state: string };

/**
 * A participant reports their location while EN_ROUTE. The server stores the
 * latest ping, computes the distance between the two parties, and — when they've
 * come together within the radius — fires the system-only CO_LOCATED action to
 * mark both arrived (server-authoritative; matches "when their locations come
 * together, mark them both arrived"). The other party's raw coordinates are
 * NEVER returned — only the distance-between and the resulting state.
 */
export async function submitLocation(
  repo: Repo,
  rail: PaymentRail,
  req: { dealId: string; userId: string; lat: number; lng: number },
  ctx: ServerCtx
): Promise<LocationResult> {
  const rec = await repo.getDeal(req.dealId);
  if (!rec) return { ok: false, code: 'not_found', reason: 'deal not found' };
  if (rec.deal.buyerId !== req.userId && rec.deal.sellerId !== req.userId) {
    return { ok: false, code: 'forbidden', reason: 'not a participant' };
  }

  await repo.upsertLocation({ dealId: req.dealId, userId: req.userId, lat: req.lat, lng: req.lng, at: ctx.now });

  const locs = await repo.getLocations(req.dealId);
  const buyerLoc = locs.find((l) => l.userId === rec.deal.buyerId);
  const sellerLoc = locs.find((l) => l.userId === rec.deal.sellerId);
  const distanceM = buyerLoc && sellerLoc ? Math.round(haversineMeters(buyerLoc, sellerLoc)) : null;

  let coLocated = false;
  let state: string = rec.deal.state;
  if (rec.deal.state === 'EN_ROUTE' && buyerLoc && sellerLoc && withinRadius(buyerLoc, sellerLoc, COLOCATION_RADIUS_M)) {
    const r = await executeAction(repo, rail, { dealId: req.dealId, action: { type: 'CO_LOCATED' }, callerUserId: null, channel: 'system' }, ctx);
    if (r.ok) {
      coLocated = true;
      state = r.deal.state;
    }
  }
  return { ok: true, distanceM, coLocated, state };
}
