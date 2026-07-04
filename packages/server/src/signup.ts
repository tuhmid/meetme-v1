import type { ServerCtx } from './ctx';
import type { Repo, UserRow } from './repo';

export type SignupResult = { ok: true; user: UserRow } | { ok: false; reason: string };

/**
 * Phone signup with the M1 sybil/abuse guards: one account per phone number,
 * no VoIP/virtual numbers, and accept-the-terms (prohibited items) at signup.
 * (Real project: `isVoip` comes from Twilio Lookup; phone is already OTP-verified.)
 */
export async function signup(repo: Repo, input: { phone: string; name: string; isVoip: boolean }, ctx: ServerCtx): Promise<SignupResult> {
  if (input.isVoip) return { ok: false, reason: 'VoIP / virtual numbers are not allowed' };
  if (await repo.getUserByPhone(input.phone)) return { ok: false, reason: 'phone already registered' };

  const user: UserRow = {
    id: ctx.newId(),
    phone: input.phone,
    phoneIsVoip: false,
    name: input.name,
    avatarColor: '#2f6f5e',
    identityTier: 'phone',
    kycStatus: 'none',
    trustScore: 50,
    completedDeals: 0,
    acceptedTermsAt: ctx.now, // signup includes accepting the terms / prohibited-items policy
  };
  await repo.addUser(user);
  return { ok: true, user };
}
