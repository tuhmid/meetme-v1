import type { Deal, DealEvent, LedgerEntry, SideEffect } from '@meetme/core';
import type { RailKind, TransferDirection, TransferStatus } from './rails/rail';

export interface TransferRow {
  dealId: string;
  provider: string;
  providerRef: string | null;
  rail: RailKind | null;
  direction: TransferDirection;
  amountCents: number;
  status: TransferStatus;
  riskScore: number | null;
  idempotencyKey: string;
}

export interface UserRow {
  id: string;
  phone: string;
  phoneIsVoip: boolean;
  name: string;
  avatarColor: string;
  identityTier: 'phone' | 'id_verified';
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  trustScore: number;
  completedDeals: number;
  acceptedTermsAt: number | null;
  hasCardOnFile: boolean; // seller commitment guarantee — required to accept terms
  cardLast4: string | null;
}

export interface DealRecord {
  deal: Deal;
  version: number; // optimistic lock
  updatedAt: number; // epoch ms of the last write — the worker's timing source
}

export interface TransitionWrite {
  deal: Deal;
  events: DealEvent[];
  ledger: LedgerEntry[];
  effects: SideEffect[];
}

/** A party's latest reported location for a deal (used only for co-location; not exposed raw to the other party). */
export interface LocationPing {
  dealId: string;
  userId: string;
  lat: number;
  lng: number;
  at: number;
}

/** An Expo push token registered by a user's device. */
export interface PushTokenRow {
  userId: string;
  token: string;
  platform?: string | null;
}

/** An invitation to a deal, addressed to a phone number (the invitee may not be registered yet). */
export interface InviteRow {
  token: string;
  inviterId: string;
  inviterRole: 'buyer' | 'seller'; // which side the inviter takes; invitee gets the other
  inviteePhone: string; // digits only
  itemDescription: string;
  amountCents: number;
  status: 'pending' | 'accepted' | 'cancelled';
  dealId: string | null;
  createdAt: number;
}

export class ConflictError extends Error {
  constructor(message = 'version conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Persistence boundary. The real implementation is a Supabase/Postgres adapter
 * whose `commit` runs everything in ONE transaction (and relies on the ledger
 * balance trigger + RLS). `MemoryRepo` mirrors the same atomic semantics for
 * local tests.
 */
export interface Repo {
  getDeal(id: string): Promise<DealRecord | null>;
  createDeal(deal: Deal): Promise<void>;
  /** Hard-delete a deal (only used for DRAFTs, which carry no money/ledger). */
  deleteDeal(id: string): Promise<void>;
  /** Atomically persist a committed transition; throws ConflictError on stale version. */
  commit(dealId: string, expectedVersion: number, write: TransitionWrite): Promise<void>;
  getUser(id: string): Promise<UserRow | null>;
  getUserByPhone(phone: string): Promise<UserRow | null>;
  addUser(user: UserRow): Promise<void>;
  /** Update a user's display name (profile sync on login). */
  setUserName(id: string, name: string): Promise<void>;
  listDealsForUser(userId: string): Promise<Deal[]>;
  /** Non-terminal deals (with version + updatedAt) for the background worker to scan. */
  listActiveDeals(): Promise<DealRecord[]>;

  // transfers (rail execution tracking)
  recordTransfer(t: TransferRow): Promise<void>;
  getFundingTransfer(dealId: string): Promise<TransferRow | null>;
  setTransferStatus(idempotencyKey: string, status: TransferStatus): Promise<void>;
  listTransfers(dealId: string): Promise<TransferRow[]>;

  // live location (M4 geofence) — one latest ping per (deal, user)
  upsertLocation(ping: LocationPing): Promise<void>;
  getLocations(dealId: string): Promise<LocationPing[]>;

  // push tokens (M5)
  savePushToken(t: PushTokenRow): Promise<void>;
  getPushTokens(userId: string): Promise<string[]>;

  // invites (M6)
  createInvite(inv: InviteRow): Promise<void>;
  getInvite(token: string): Promise<InviteRow | null>;
  listPendingInvitesForPhone(phone: string): Promise<InviteRow[]>;
  markInviteAccepted(token: string, dealId: string): Promise<void>;
  cancelInvite(token: string): Promise<void>; // declined by invitee or rescinded by inviter

  // KYC / identity tier (M?)
  setKyc(id: string, tier: 'phone' | 'id_verified', status: 'none' | 'pending' | 'verified' | 'rejected'): Promise<void>;

  // card on file (seller commitment) + the deal's active card hold
  setCardOnFile(userId: string, last4: string): Promise<void>;
  setSellerHold(dealId: string, holdId: string | null): Promise<void>;

  // chat
  addMessage(dealId: string, senderId: string, body: string | null, imagePath?: string | null): Promise<void>;
  listMessages(dealId: string): Promise<{ senderId: string; body: string | null; imagePath: string | null; createdAt: number }[]>;
  putDealImage(dealId: string, bytes: Uint8Array, contentType: string): Promise<string>; // returns the stored path
  signImageUrl(path: string): Promise<string | null>; // short-lived signed URL for a stored image

  // safety: block + report
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  isBlocked(a: string, b: string): Promise<boolean>; // either direction
  /** Users this person has blocked (their direction only), with names for the list UI. */
  listBlocked(blockerId: string): Promise<{ id: string; name: string }[]>;
  /** Remove the blocker's own block on a user (one direction). */
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  reportUser(r: { reporterId: string; reportedId: string; dealId: string | null; reason: string }): Promise<void>;
}
