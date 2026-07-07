// Thin client for the MeetMe API. Set EXPO_PUBLIC_API_URL to your machine's
// address: iOS simulator can use http://localhost:8787; Android emulator uses
// http://10.0.2.2:8787; a physical device uses http://<your-mac-LAN-ip>:8787.
//
// `auth` is the bearer token VALUE: a real Supabase access token, or the demo
// shortcut `dev:<userId>`.
const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

export type Role = 'buyer' | 'seller';
export type Action =
  | { type: 'ACCEPT_TERMS' }
  | { type: 'FUND' }
  | { type: 'HEAD_OUT'; actor: Role }
  | { type: 'ARRIVE'; party: Role }
  | { type: 'SET_MEETUP'; actor: Role; name: string; lat: number; lng: number; custom: boolean }
  | { type: 'REVEAL_CODE' }
  | { type: 'ENTER_CODE'; code: string }
  | { type: 'CONFIRM_RECEIVED' }
  | { type: 'OPEN_DISPUTE'; actor: Role }
  | { type: 'SUBMIT_POSITION'; actor: Role; text: string }
  | { type: 'PROPOSE_RESOLUTION'; actor: Role; outcome: 'release' | 'refund' | 'split' }
  | { type: 'CANCEL'; actor: Role }
  | { type: 'RATE'; actor: Role; stars: number };

export interface Deal {
  id: string;
  buyerId: string;
  sellerId: string;
  itemDescription: string;
  amountCents: number;
  totalFeeCents: number; // whole-deal fee; the buyer/seller split is derived client-side
  commitmentCents: number; // flat $5 deposit per side
  state: string;
  codeRevealed: boolean;
  buyerHeadedOut: boolean;
  sellerHeadedOut: boolean;
  buyerArrived: boolean;
  sellerArrived: boolean;
  meetupName: string | null;
  meetupLat: number | null;
  meetupLng: number | null;
  meetupCustom: boolean;
  resolutionNote: string | null;
  disputePositions: { actor: Role; text: string; at: number }[];
  disputeProposals: { buyer?: 'release' | 'refund' | 'split'; seller?: 'release' | 'refund' | 'split' };
  ratings: { buyer?: number; seller?: number };
}
export interface Transfer { direction: string; status: string; amountCents: number }
export interface UserProfile {
  id: string;
  name: string;
  avatarColor: string;
  idVerified: boolean;
  trustScore: number;
  completedDeals: number;
  memberSince: number | null;
  blocked: boolean;
  shared: { id: string; itemDescription: string; amountCents: number; state: string; youWere: Role }[];
  // self-only (present when you request your own profile)
  hasCardOnFile?: boolean;
  cardLast4?: string | null;
}
export interface Invite { token: string; inviterName: string; itemDescription: string; amountCents: number; yourRole: Role }
export interface MeetupSpot { name: string; lat: number; lng: number; category: string; tier: 'verified' | 'public'; minutesBuyer: number | null; minutesSeller: number | null }

async function req(method: string, path: string, body?: unknown, auth?: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = `Bearer ${auth}`;
  // Only set a JSON content-type when we actually send a body — Fastify rejects an
  // application/json content-type with an empty body (e.g. body-less DELETE).
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { code: json.code as string | undefined });
  return json;
}

export interface NewDeal {
  counterpartyUserId?: string;
  counterpartyPhone?: string;
  itemDescription: string;
  amountCents: number;
}

export const api = {
  // dev-only: mint a demo profile (used by Demo mode). Real users come from phone auth.
  signup: (phone: string, name: string) => req('POST', '/signup', { phone, name }) as Promise<{ userId: string; name: string }>,
  createDeal: (auth: string, deal: NewDeal) => req('POST', '/deals', deal, auth) as Promise<{ dealId: string }>,
  listDeals: (auth: string) => req('GET', '/deals', undefined, auth) as Promise<{ deals: Deal[] }>,
  getDeal: (auth: string, id: string) =>
    req('GET', `/deals/${id}`, undefined, auth) as Promise<{
      deal: Deal;
      transfers: Transfer[];
      buyerName: string | null;
      sellerName: string | null;
      buyerTrust: number | null;
      sellerTrust: number | null;
      buyerDeals: number;
      sellerDeals: number;
      mapUrl: string | null;
    }>,
  act: (auth: string, id: string, action: Action) => req('POST', `/deals/${id}/actions`, { action }, auth) as Promise<{ deal: Deal; secret?: { releaseCode: string } }>,
  sendLocation: (auth: string, id: string, lat: number, lng: number) =>
    req('POST', `/deals/${id}/location`, { lat, lng }, auth) as Promise<{ distanceM: number | null; coLocated: boolean; state: string }>,
  geocode: (auth: string, q: string) => req('GET', `/geocode?q=${encodeURIComponent(q)}`, undefined, auth) as Promise<{ name: string; lat: number; lng: number }>,
  meetupSuggestions: (auth: string, id: string) =>
    req('GET', `/deals/${id}/meetup-suggestions`, undefined, auth) as Promise<{ needLocation?: boolean; haveBuyer?: boolean; haveSeller?: boolean; suggestions: MeetupSpot[] }>,
  updateProfile: (auth: string, name: string) => req('POST', '/profile', { name }, auth) as Promise<{ ok: boolean }>,
  registerPushToken: (auth: string, token: string, platform?: string) =>
    req('POST', '/push-token', { token, platform }, auth) as Promise<{ ok: boolean }>,
  deleteDeal: (auth: string, id: string) => req('DELETE', `/deals/${id}`, undefined, auth) as Promise<{ ok: boolean }>,
  createInvite: (auth: string, counterpartyPhone: string, itemDescription: string, amountCents: number, role: Role) =>
    req('POST', '/invites', { counterpartyPhone, itemDescription, amountCents, role }, auth) as Promise<{ token: string }>,
  listInvites: (auth: string) => req('GET', '/invites', undefined, auth) as Promise<{ invites: Invite[] }>,
  acceptInvite: (auth: string, token: string) => req('POST', `/invites/${token}/accept`, {}, auth) as Promise<{ dealId: string }>,
  declineInvite: (auth: string, token: string) => req('POST', `/invites/${token}/decline`, {}, auth) as Promise<{ ok: boolean }>,
  verifyKyc: (auth: string) => req('POST', '/kyc/verify', {}, auth) as Promise<{ ok: boolean }>,
  settleFunding: (id: string) => req('POST', `/dev/deals/${id}/settle-funding`, {}) as Promise<{ ok: boolean }>,
  resolveDispute: (id: string, outcome: 'release' | 'refund' | 'split') =>
    req('POST', `/dev/deals/${id}/resolve`, { outcome }) as Promise<{ ok: boolean; deal?: Deal; error?: string }>,
  listMessages: (auth: string, id: string) =>
    req('GET', `/deals/${id}/messages`, undefined, auth) as Promise<{ messages: { senderId: string; body: string; createdAt: number }[] }>,
  sendMessage: (auth: string, id: string, body: string) => req('POST', `/deals/${id}/messages`, { body }, auth) as Promise<{ ok: boolean }>,
  getUserProfile: (auth: string, id: string) => req('GET', `/users/${id}/profile`, undefined, auth) as Promise<UserProfile>,
  blockUser: (auth: string, id: string) => req('POST', `/users/${id}/block`, {}, auth) as Promise<{ ok: boolean }>,
  reportUser: (auth: string, id: string, reason: string, dealId?: string) => req('POST', `/users/${id}/report`, { reason, dealId }, auth) as Promise<{ ok: boolean }>,
  addPaymentMethod: (auth: string) => req('POST', '/payment-method', {}, auth) as Promise<{ ok: boolean; last4: string }>,
  listBlocked: (auth: string) => req('GET', '/blocks', undefined, auth) as Promise<{ blocked: { id: string; name: string }[] }>,
  unblock: (auth: string, id: string) => req('DELETE', `/users/${id}/block`, undefined, auth) as Promise<{ ok: boolean }>,
};
