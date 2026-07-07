import { COLOCATION_RADIUS_M, haversineMeters, withinRadius } from '@meetme/core';
import { executeAction } from './payments';
import type { PaymentRail } from './rails/rail';
import type { Repo } from './repo';
import type { ServerCtx } from './ctx';

export type LocationResult =
  | { ok: false; code: 'not_found' | 'forbidden'; reason: string }
  | { ok: true; distanceM: number | null; coLocated: boolean; state: string };

/**
 * A participant reports their live location while EN_ROUTE. Arrival is detected
 * automatically, two ways:
 *
 *  1. If a meetup spot is agreed, a ping within the geofence of the SPOT marks
 *     THAT party arrived (a real ARRIVE on their behalf). This sets the per-party
 *     arrival flag, so the no-show worker still fires if the other never shows —
 *     and once both are at the spot the deal advances to AT_MEETUP.
 *  2. With no agreed spot, we fall back to the two phones coming together within
 *     the radius (the system-only CO_LOCATED, marking both at once).
 *
 * The other party's raw coordinates are NEVER returned — only the distance-between
 * and the resulting state.
 */
export async function submitLocation(
  repo: Repo,
  rail: PaymentRail,
  req: { dealId: string; userId: string; lat: number; lng: number },
  ctx: ServerCtx
): Promise<LocationResult> {
  const rec = await repo.getDeal(req.dealId);
  if (!rec) return { ok: false, code: 'not_found', reason: 'deal not found' };
  const { deal } = rec;
  if (deal.buyerId !== req.userId && deal.sellerId !== req.userId) {
    return { ok: false, code: 'forbidden', reason: 'not a participant' };
  }

  await repo.upsertLocation({ dealId: req.dealId, userId: req.userId, lat: req.lat, lng: req.lng, at: ctx.now });

  const locs = await repo.getLocations(req.dealId);
  const buyerLoc = locs.find((l) => l.userId === deal.buyerId);
  const sellerLoc = locs.find((l) => l.userId === deal.sellerId);
  const distanceM = buyerLoc && sellerLoc ? Math.round(haversineMeters(buyerLoc, sellerLoc)) : null;

  let coLocated = false;
  let state: string = deal.state;
  const spot = deal.meetupLat != null && deal.meetupLng != null ? { lat: deal.meetupLat, lng: deal.meetupLng } : null;

  if (deal.state === 'EN_ROUTE' && spot && withinRadius({ lat: req.lat, lng: req.lng }, spot, COLOCATION_RADIUS_M)) {
    // This party reached the agreed spot — auto-arrive them (channel 'user', on their behalf).
    const role: 'buyer' | 'seller' = deal.buyerId === req.userId ? 'buyer' : 'seller';
    const already = role === 'buyer' ? deal.buyerArrived : deal.sellerArrived;
    if (!already) {
      const r = await executeAction(repo, rail, { dealId: req.dealId, action: { type: 'ARRIVE', party: role }, callerUserId: req.userId, channel: 'user' }, ctx);
      if (r.ok) state = r.deal.state; // -> AT_MEETUP once both are here
    }
  } else if (deal.state === 'EN_ROUTE' && !spot && buyerLoc && sellerLoc && withinRadius(buyerLoc, sellerLoc, COLOCATION_RADIUS_M)) {
    // No agreed spot — fall back to the two phones meeting.
    const r = await executeAction(repo, rail, { dealId: req.dealId, action: { type: 'CO_LOCATED' }, callerUserId: null, channel: 'system' }, ctx);
    if (r.ok) state = r.deal.state;
  }

  coLocated = state === 'AT_MEETUP' && deal.state === 'EN_ROUTE'; // just reached the meetup this ping
  return { ok: true, distanceM, coLocated, state };
}
