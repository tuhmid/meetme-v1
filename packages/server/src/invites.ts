import { createDealHandler } from './handler';
import type { Repo } from './repo';
import type { ServerCtx } from './ctx';

export type AcceptInviteResult = { ok: true; dealId: string } | { ok: false; reason: string };

/**
 * Accept a pending invite: the inviter becomes the buyer, the accepter the seller,
 * and the real deal is created. Idempotency: a non-pending invite is rejected.
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

  await repo.markInviteAccepted(inv.token, created.deal.id);
  return { ok: true, dealId: created.deal.id };
}
