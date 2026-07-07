import { createDealHandler, handleAction } from './handler';
import type { Repo } from './repo';
import type { ServerCtx } from './ctx';

export type AcceptInviteResult =
  | { ok: true; dealId: string }
  | { ok: false; reason: string; code?: 'card_required' };

/**
 * Accept a pending invite: the inviter and accepter take the two sides, the real
 * deal is created, and the seller's terms are sealed right away so the deal lands
 * in AGREED — the buyer's next tap is a single "Accept & fund", never a redundant
 * "Accept terms" turn. Both parties have effectively agreed (the inviter by
 * inviting, the accepter by accepting).
 *
 * Idempotency: a non-pending invite is rejected. If the seller has no card on file
 * we roll the empty DRAFT back so the invite stays open for a retry after they add one.
 */
export async function acceptInvite(repo: Repo, args: { token: string; accepterUserId: string }, ctx: ServerCtx): Promise<AcceptInviteResult> {
  const inv = await repo.getInvite(args.token);
  if (!inv) return { ok: false, reason: 'invite not found' };
  if (inv.status !== 'pending') return { ok: false, reason: 'this invite was already used' };
  if (inv.inviterId === args.accepterUserId) return { ok: false, reason: 'you cannot accept your own invite' };

  const created = await createDealHandler(
    repo,
    { creatorUserId: inv.inviterId, counterpartyUserId: args.accepterUserId, itemDescription: inv.itemDescription, amountCents: inv.amountCents, creatorRole: inv.inviterRole },
    ctx
  );
  if (!created.ok) return { ok: false, reason: created.reason };

  // Seal the seller's side (DRAFT -> AGREED). Card-on-file gate lives in handleAction.
  const terms = await handleAction(repo, { dealId: created.deal.id, action: { type: 'ACCEPT_TERMS' }, callerUserId: created.deal.sellerId, channel: 'user' }, ctx);
  if (!terms.ok) {
    await repo.deleteDeal(created.deal.id); // DRAFT carries no money/ledger — safe to drop
    return { ok: false, reason: terms.reason, code: terms.code === 'card_required' ? 'card_required' : undefined };
  }

  await repo.markInviteAccepted(inv.token, created.deal.id);
  return { ok: true, dealId: created.deal.id };
}
