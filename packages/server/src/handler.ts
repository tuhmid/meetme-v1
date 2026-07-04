import { applyAction, createDeal, requiresKyc, usd, PHONE_TIER_MAX_CENTS, type Action, type Deal, type LedgerEntry, type Role, type UseCase } from '@meetme/core';
import { authorize, type Channel } from './authz';
import type { ServerCtx } from './ctx';
import { ConflictError, type Repo } from './repo';

function roleOf(deal: Deal, userId: string | null): Role | null {
  if (userId !== null && userId === deal.buyerId) return 'buyer';
  if (userId !== null && userId === deal.sellerId) return 'seller';
  return null;
}

export interface ActionRequest {
  dealId: string;
  action: Action;
  callerUserId: string | null;
  channel: Channel;
}

export type HandlerResult =
  | { ok: false; code: 'not_found' | 'forbidden' | 'rejected' | 'conflict'; reason: string }
  | { ok: true; deal: Deal; ledger: LedgerEntry[]; secret?: { releaseCode: string } };

/**
 * The one server entry point for mutating a deal. Order matters:
 *   load → AUTHORIZE (who) → applyAction (when/what, via @meetme/core) → COMMIT atomically.
 * A failure at any gate persists NOTHING (no side-effects on rejection — the
 * prototype's "effects after a rejected transition" bug is structurally impossible).
 */
export async function handleAction(repo: Repo, req: ActionRequest, ctx: ServerCtx): Promise<HandlerResult> {
  const rec = await repo.getDeal(req.dealId);
  if (!rec) return { ok: false, code: 'not_found', reason: 'deal not found' };

  const az = authorize(req.action, roleOf(rec.deal, req.callerUserId), req.channel);
  if (!az.ok) return { ok: false, code: 'forbidden', reason: az.reason };

  const result = applyAction(rec.deal, req.action, ctx);
  if (!result.ok) return { ok: false, code: 'rejected', reason: result.reason };

  try {
    await repo.commit(req.dealId, rec.version, {
      deal: result.deal,
      events: result.events,
      ledger: result.ledger,
      effects: result.effects,
    });
  } catch (e) {
    if (e instanceof ConflictError) return { ok: false, code: 'conflict', reason: 'the deal changed; reload and retry' };
    throw e;
  }

  return result.secret
    ? { ok: true, deal: result.deal, ledger: result.ledger, secret: result.secret }
    : { ok: true, deal: result.deal, ledger: result.ledger };
}

export type CreateDealResult = { ok: true; deal: Deal } | { ok: false; code: 'forbidden' | 'invalid' | 'kyc_required'; reason: string };

/**
 * Create a deal. `creatorRole` says which side the creator is on (default 'buyer'),
 * so either party can initiate — the counterparty takes the other side.
 */
export async function createDealHandler(
  repo: Repo,
  input: { creatorUserId: string; counterpartyUserId: string; itemDescription: string; amountCents: number; useCase?: UseCase; creatorRole?: Role },
  ctx: ServerCtx
): Promise<CreateDealResult> {
  if (input.creatorUserId === input.counterpartyUserId) return { ok: false, code: 'invalid', reason: 'cannot deal with yourself' };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, code: 'invalid', reason: 'amount must be a positive integer (cents)' };
  if (!input.itemDescription || !input.itemDescription.trim()) return { ok: false, code: 'invalid', reason: 'item description required' };

  const creator = await repo.getUser(input.creatorUserId);
  if (!creator) return { ok: false, code: 'forbidden', reason: 'unknown creator' };
  if (creator.acceptedTermsAt === null) return { ok: false, code: 'forbidden', reason: 'must accept terms first' };
  if (requiresKyc(creator.identityTier === 'id_verified', input.amountCents)) {
    return { ok: false, code: 'kyc_required', reason: `Verify your ID to create deals over ${usd(PHONE_TIER_MAX_CENTS)}.` };
  }
  if (!(await repo.getUser(input.counterpartyUserId))) return { ok: false, code: 'invalid', reason: 'unknown counterparty' };
  if (await repo.isBlocked(input.creatorUserId, input.counterpartyUserId)) return { ok: false, code: 'forbidden', reason: "You can't start a deal with this person." };

  const creatorIsBuyer = (input.creatorRole ?? 'buyer') === 'buyer';
  const deal = createDeal({
    id: ctx.newId(),
    buyerId: creatorIsBuyer ? input.creatorUserId : input.counterpartyUserId,
    sellerId: creatorIsBuyer ? input.counterpartyUserId : input.creatorUserId,
    useCase: input.useCase ?? 'marketplace',
    itemDescription: input.itemDescription,
    amountCents: input.amountCents,
  });
  await repo.createDeal(deal);
  return { ok: true, deal };
}
