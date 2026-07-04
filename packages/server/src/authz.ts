import type { Action, Role } from '@meetme/core';

/** Who is calling: a participant ('user'), the background worker ('system'), or staff ('admin'). */
export type Channel = 'user' | 'system' | 'admin';
export type Authz = { ok: true } | { ok: false; reason: string };

const OK: Authz = { ok: true };
const no = (reason: string): Authz => ({ ok: false, reason });

const BUYER_ONLY = new Set(['FUND', 'REVEAL_CODE', 'CONFIRM_RECEIVED']);
const SELLER_ONLY = new Set(['ACCEPT_TERMS', 'POST_STAKE', 'ENTER_CODE']);

/**
 * The core validates WHEN an action is legal (state machine). This validates WHO
 * may do it — the missing layer that caused the prototype's role/identity bugs.
 */
export function authorize(action: Action, role: Role | null, channel: Channel): Authz {
  // System / admin-only actions
  if (action.type === 'AUTO_RELEASE' || action.type === 'EXPIRE_NO_SHOW' || action.type === 'CO_LOCATED') {
    return channel === 'system' ? OK : no(`${action.type} is system-only`);
  }
  if (action.type === 'RESOLVE_DISPUTE') {
    return channel === 'admin' || channel === 'system' ? OK : no('RESOLVE_DISPUTE is admin/system-only');
  }

  // Everything else is a participant action.
  if (channel !== 'user') return no(`${action.type} must come from a participant`);
  if (role === null) return no('not a participant in this deal');

  if (BUYER_ONLY.has(action.type) && role !== 'buyer') return no(`${action.type} is buyer-only`);
  if (SELLER_ONLY.has(action.type) && role !== 'seller') return no(`${action.type} is seller-only`);
  if (action.type === 'ARRIVE' && action.party !== role) return no('you can only mark yourself arrived');
  if ('actor' in action && action.actor !== role) return no('actor must be you');

  return OK;
}
