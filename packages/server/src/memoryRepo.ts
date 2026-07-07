import { isTerminal, type SideEffect } from '@meetme/core';
import { ConflictError, type DealRecord, type InviteRow, type LocationPing, type PushTokenRow, type Repo, type TransitionWrite, type TransferRow, type UserRow } from './repo';
import type { TransferStatus } from './rails/rail';

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * In-memory repo that mirrors the real adapter's ATOMIC semantics (a commit
 * applies the deal + events + ledger + effects all-or-nothing, bumping version).
 * For local dev and tests; the Supabase adapter implements the same interface.
 */
export class MemoryRepo implements Repo {
  deals = new Map<string, DealRecord>();
  users = new Map<string, UserRow>();
  private byPhone = new Map<string, string>();
  events: Array<{ dealId: string; type: string; actor: string; note: string; at: number }> = [];
  ledger: Array<{ txnId: string; account: string; amountCents: number; dealId: string; memo: string }> = [];
  ratings: Array<{ rateeId: string; raterId: string; stars: number }> = [];
  /** injectable clock so worker timing is deterministic in tests */
  clock: () => number = () => Date.now();

  async getDeal(id: string): Promise<DealRecord | null> {
    const r = this.deals.get(id);
    return r ? { deal: structuredClone(r.deal), version: r.version, updatedAt: r.updatedAt } : null;
  }

  async createDeal(deal: DealRecord['deal']): Promise<void> {
    this.deals.set(deal.id, { deal: structuredClone(deal), version: 0, updatedAt: this.clock() });
  }

  async deleteDeal(id: string): Promise<void> {
    this.deals.delete(id);
  }

  async commit(dealId: string, expectedVersion: number, write: TransitionWrite): Promise<void> {
    const r = this.deals.get(dealId);
    if (!r) throw new Error('deal not found');
    if (r.version !== expectedVersion) throw new ConflictError();
    // all-or-nothing: stage then apply (in-memory there's no partial failure)
    this.deals.set(dealId, { deal: structuredClone(write.deal), version: r.version + 1, updatedAt: this.clock() });
    for (const e of write.events) this.events.push({ ...e, dealId });
    for (const l of write.ledger) this.ledger.push(l);
    for (const eff of write.effects) this.applyEffect(eff);
  }

  private applyEffect(eff: SideEffect): void {
    if (eff.type === 'deal_completed') {
      for (const id of eff.userIds) {
        const u = this.users.get(id);
        if (u) u.completedDeals += 1;
      }
    } else if (eff.type === 'trust_delta') {
      const u = this.users.get(eff.userId);
      if (u) u.trustScore = clamp(u.trustScore + eff.delta);
    } else if (eff.type === 'rating') {
      this.ratings.push({ rateeId: eff.rateeId, raterId: eff.raterId, stars: eff.stars });
      const rs = this.ratings.filter((r) => r.rateeId === eff.rateeId);
      const avg = rs.reduce((s, r) => s + r.stars, 0) / rs.length;
      const u = this.users.get(eff.rateeId);
      if (u) u.trustScore = clamp(Math.round((avg / 5) * 100));
    }
  }

  async getUser(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }
  async getUserByPhone(phone: string): Promise<UserRow | null> {
    const id = this.byPhone.get(phone);
    return id ? this.getUser(id) : null;
  }
  async addUser(user: UserRow): Promise<void> {
    this.users.set(user.id, { ...user });
    this.byPhone.set(user.phone, user.id);
  }
  async setUserName(id: string, name: string): Promise<void> {
    const u = this.users.get(id);
    if (u) u.name = name;
  }

  async listDealsForUser(userId: string): Promise<DealRecord['deal'][]> {
    return [...this.deals.values()].filter((r) => r.deal.buyerId === userId || r.deal.sellerId === userId).map((r) => structuredClone(r.deal));
  }

  async listActiveDeals(): Promise<DealRecord[]> {
    return [...this.deals.values()]
      .filter((r) => !isTerminal(r.deal.state))
      .map((r) => ({ deal: structuredClone(r.deal), version: r.version, updatedAt: r.updatedAt }));
  }

  transfers: TransferRow[] = [];
  async recordTransfer(t: TransferRow): Promise<void> {
    this.transfers.push({ ...t });
  }
  async getFundingTransfer(dealId: string): Promise<TransferRow | null> {
    return this.transfers.find((t) => t.dealId === dealId && t.direction === 'fund_buyer') ?? null;
  }
  async setTransferStatus(idempotencyKey: string, status: TransferStatus): Promise<void> {
    const t = this.transfers.find((x) => x.idempotencyKey === idempotencyKey);
    if (t) t.status = status;
  }
  async listTransfers(dealId: string): Promise<TransferRow[]> {
    return this.transfers.filter((t) => t.dealId === dealId).map((t) => ({ ...t }));
  }

  locations = new Map<string, LocationPing>(); // key: `${dealId}:${userId}` — latest wins
  async upsertLocation(ping: LocationPing): Promise<void> {
    this.locations.set(`${ping.dealId}:${ping.userId}`, { ...ping });
  }
  async getLocations(dealId: string): Promise<LocationPing[]> {
    return [...this.locations.values()].filter((p) => p.dealId === dealId).map((p) => ({ ...p }));
  }

  pushTokens: PushTokenRow[] = [];
  async savePushToken(t: PushTokenRow): Promise<void> {
    if (!this.pushTokens.some((x) => x.userId === t.userId && x.token === t.token)) this.pushTokens.push({ ...t });
  }
  async getPushTokens(userId: string): Promise<string[]> {
    return this.pushTokens.filter((t) => t.userId === userId).map((t) => t.token);
  }

  invites: InviteRow[] = [];
  async createInvite(inv: InviteRow): Promise<void> {
    this.invites.push({ ...inv });
  }
  async getInvite(token: string): Promise<InviteRow | null> {
    const i = this.invites.find((x) => x.token === token);
    return i ? { ...i } : null;
  }
  async listPendingInvitesForPhone(phone: string): Promise<InviteRow[]> {
    return this.invites.filter((i) => i.inviteePhone === phone && i.status === 'pending').map((i) => ({ ...i }));
  }
  async markInviteAccepted(token: string, dealId: string): Promise<void> {
    const i = this.invites.find((x) => x.token === token);
    if (i) { i.status = 'accepted'; i.dealId = dealId; }
  }
  async cancelInvite(token: string): Promise<void> {
    const i = this.invites.find((x) => x.token === token);
    if (i) i.status = 'cancelled';
  }

  async setKyc(id: string, tier: 'phone' | 'id_verified', status: 'none' | 'pending' | 'verified' | 'rejected'): Promise<void> {
    const u = this.users.get(id);
    if (u) { u.identityTier = tier; u.kycStatus = status; }
  }

  async setCardOnFile(userId: string, last4: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) { u.hasCardOnFile = true; u.cardLast4 = last4; }
  }

  async setSellerHold(dealId: string, holdId: string | null): Promise<void> {
    const r = this.deals.get(dealId);
    if (r) r.deal.sellerHoldId = holdId;
  }

  messages: Array<{ dealId: string; senderId: string; body: string; createdAt: number }> = [];
  async addMessage(dealId: string, senderId: string, body: string): Promise<void> {
    this.messages.push({ dealId, senderId, body, createdAt: this.clock() });
  }
  async listMessages(dealId: string): Promise<{ senderId: string; body: string; createdAt: number }[]> {
    return this.messages.filter((m) => m.dealId === dealId).map((m) => ({ senderId: m.senderId, body: m.body, createdAt: m.createdAt }));
  }

  blocks: Array<{ blockerId: string; blockedId: string }> = [];
  reports: Array<{ reporterId: string; reportedId: string; dealId: string | null; reason: string }> = [];
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (!this.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId)) this.blocks.push({ blockerId, blockedId });
  }
  async isBlocked(a: string, b: string): Promise<boolean> {
    return this.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
  }
  async reportUser(r: { reporterId: string; reportedId: string; dealId: string | null; reason: string }): Promise<void> {
    this.reports.push({ ...r });
  }
}
