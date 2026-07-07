import { createClient } from '@supabase/supabase-js';
import { ALLOWED_TRANSITIONS, isTerminal, type Deal, type DealState } from '@meetme/core';
import { ConflictError, type DealRecord, type InviteRow, type LocationPing, type PushTokenRow, type Repo, type TransferRow, type TransitionWrite, type UserRow } from './repo';
import type { TransferStatus } from './rails/rail';

const ACTIVE_STATES = (Object.keys(ALLOWED_TRANSITIONS) as DealState[]).filter((s) => !isTerminal(s));

/**
 * Postgres-backed Repo using the service-role key (server only; bypasses RLS).
 * `commit` delegates to the `apply_transition` RPC so the whole write is ONE
 * atomic, version-checked transaction — same semantics as MemoryRepo.
 * (Dispute-position persistence lands in M6; M1 covers the main loop.)
 */
export function makeSupabaseRepo(url: string, serviceRoleKey: string): Repo {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const rowToUser = (r: Record<string, any>): UserRow => ({
    id: r.id,
    phone: r.phone,
    phoneIsVoip: r.phone_is_voip,
    name: r.name,
    avatarColor: r.avatar_color,
    identityTier: r.identity_tier,
    kycStatus: r.kyc_status,
    trustScore: r.trust_score,
    completedDeals: r.completed_deals,
    acceptedTermsAt: r.accepted_terms_at ? Date.parse(r.accepted_terms_at) : null,
    hasCardOnFile: !!r.has_card_on_file,
    cardLast4: r.card_last4 ?? null,
  });

  const rowToDeal = (r: Record<string, any>, ratings: { buyer?: number; seller?: number }, disputePositions: Deal['disputePositions'] = [], disputeProposals: Deal['disputeProposals'] = {}): Deal => ({
    id: r.id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    useCase: r.use_case,
    itemDescription: r.item_description,
    amountCents: Number(r.amount_cents),
    // column names predate the flat-deposit model: fee_cents_per_side now stores
    // the deal's TOTAL fee, commitment_cents the flat $5 deposit (no migration)
    totalFeeCents: Number(r.fee_cents_per_side),
    commitmentCents: Number(r.commitment_cents),
    state: r.state,
    releaseCodeHash: r.release_code_hash,
    codeRevealed: r.code_revealed,
    buyerHeadedOut: r.buyer_headed_out_at != null,
    sellerHeadedOut: r.seller_headed_out_at != null,
    buyerArrived: r.buyer_arrived_at != null,
    sellerArrived: r.seller_arrived_at != null,
    meetupName: r.meetup_name ?? null,
    meetupLat: r.meetup_lat != null ? Number(r.meetup_lat) : null,
    meetupLng: r.meetup_lng != null ? Number(r.meetup_lng) : null,
    meetupCustom: !!r.meetup_custom,
    sellerHoldId: r.seller_hold_id ?? null,
    faultParty: r.fault_party,
    resolutionNote: r.resolution_note,
    disputePositions,
    disputeProposals,
    ratings,
  });

  return {
    async getDeal(id: string): Promise<DealRecord | null> {
      const { data, error } = await db.from('deals').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: rts, error: rErr } = await db.from('ratings').select('rater_id,stars').eq('deal_id', id);
      if (rErr) throw rErr;
      const ratings: { buyer?: number; seller?: number } = {};
      for (const rt of rts ?? []) {
        if (rt.rater_id === data.buyer_id) ratings.buyer = rt.stars;
        else if (rt.rater_id === data.seller_id) ratings.seller = rt.stars;
      }
      const { data: pos, error: pErr } = await db
        .from('dispute_positions')
        .select('actor, text, at, disputes!inner(deal_id)')
        .eq('disputes.deal_id', id)
        .order('at', { ascending: true });
      if (pErr) throw pErr;
      const disputePositions = (pos ?? []).map((p: any) => ({ actor: p.actor, text: p.text, at: Date.parse(p.at) }));
      const { data: disp } = await db.from('disputes').select('buyer_proposal, seller_proposal').eq('deal_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const disputeProposals: Deal['disputeProposals'] = {};
      if (disp?.buyer_proposal) disputeProposals.buyer = disp.buyer_proposal;
      if (disp?.seller_proposal) disputeProposals.seller = disp.seller_proposal;
      return { deal: rowToDeal(data, ratings, disputePositions, disputeProposals), version: data.version, updatedAt: Date.parse(data.updated_at) };
    },

    async createDeal(deal: Deal): Promise<void> {
      const { error } = await db.from('deals').insert({
        id: deal.id,
        created_by: deal.buyerId,
        buyer_id: deal.buyerId,
        seller_id: deal.sellerId,
        use_case: deal.useCase,
        item_description: deal.itemDescription,
        amount_cents: deal.amountCents,
        fee_cents_per_side: deal.totalFeeCents, // legacy column name; holds the TOTAL fee
        commitment_cents: deal.commitmentCents, // the flat $5 deposit

        state: deal.state,
        release_code_hash: deal.releaseCodeHash,
        code_revealed: deal.codeRevealed,
      });
      if (error) throw error;
    },

    async deleteDeal(id: string): Promise<void> {
      const { error } = await db.from('deals').delete().eq('id', id);
      if (error) throw error;
    },

    async commit(dealId: string, expectedVersion: number, write: TransitionWrite): Promise<void> {
      const { error } = await db.rpc('apply_transition', {
        p_deal_id: dealId,
        p_expected_version: expectedVersion,
        p_deal: write.deal,
        p_events: write.events,
        p_ledger: write.ledger,
        p_effects: write.effects,
      });
      if (error) {
        if ((error.message ?? '').includes('version conflict') || error.code === '40001') throw new ConflictError();
        throw error;
      }
    },

    async getUser(id: string): Promise<UserRow | null> {
      const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? rowToUser(data) : null;
    },

    async getUserByPhone(phone: string): Promise<UserRow | null> {
      const { data, error } = await db.from('users').select('*').eq('phone', phone).maybeSingle();
      if (error) throw error;
      return data ? rowToUser(data) : null;
    },

    async addUser(user: UserRow): Promise<void> {
      const { error } = await db.from('users').insert({
        id: user.id,
        phone: user.phone,
        phone_is_voip: user.phoneIsVoip,
        name: user.name,
        avatar_color: user.avatarColor,
        identity_tier: user.identityTier,
        kyc_status: user.kycStatus,
        trust_score: user.trustScore,
        completed_deals: user.completedDeals,
        accepted_terms_at: user.acceptedTermsAt ? new Date(user.acceptedTermsAt).toISOString() : null,
        has_card_on_file: user.hasCardOnFile,
        card_last4: user.cardLast4,
      });
      if (error) throw error;
    },

    async setUserName(id: string, name: string): Promise<void> {
      const { error } = await db.from('users').update({ name }).eq('id', id);
      if (error) throw error;
    },

    async listDealsForUser(userId: string): Promise<Deal[]> {
      const { data, error } = await db.from('deals').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
      if (error) throw error;
      return (data ?? []).map((r) => rowToDeal(r, {}));
    },

    async listActiveDeals(): Promise<DealRecord[]> {
      const { data, error } = await db.from('deals').select('*').in('state', ACTIVE_STATES);
      if (error) throw error;
      return (data ?? []).map((r) => ({ deal: rowToDeal(r, {}), version: r.version, updatedAt: Date.parse(r.updated_at) }));
    },

    async recordTransfer(t: TransferRow): Promise<void> {
      const { error } = await db.from('transfers').insert({
        deal_id: t.dealId,
        provider: t.provider,
        provider_ref: t.providerRef,
        rail: t.rail,
        direction: t.direction,
        amount_cents: t.amountCents,
        status: t.status,
        risk_score: t.riskScore,
        idempotency_key: t.idempotencyKey,
      });
      if (error) throw error;
    },

    async getFundingTransfer(dealId: string): Promise<TransferRow | null> {
      const { data, error } = await db.from('transfers').select('*').eq('deal_id', dealId).eq('direction', 'fund_buyer').maybeSingle();
      if (error) throw error;
      return data ? rowToTransfer(data) : null;
    },

    async setTransferStatus(idempotencyKey: string, status: TransferStatus): Promise<void> {
      const { error } = await db
        .from('transfers')
        .update({ status, settled_at: status === 'settled' ? new Date().toISOString() : null })
        .eq('idempotency_key', idempotencyKey);
      if (error) throw error;
    },

    async listTransfers(dealId: string): Promise<TransferRow[]> {
      const { data, error } = await db.from('transfers').select('*').eq('deal_id', dealId);
      if (error) throw error;
      return (data ?? []).map(rowToTransfer);
    },

    async upsertLocation(ping: LocationPing): Promise<void> {
      const { error } = await db.from('deal_locations').upsert(
        { deal_id: ping.dealId, user_id: ping.userId, lat: ping.lat, lng: ping.lng, updated_at: new Date(ping.at).toISOString() },
        { onConflict: 'deal_id,user_id' }
      );
      if (error) throw error;
    },

    async getLocations(dealId: string): Promise<LocationPing[]> {
      const { data, error } = await db.from('deal_locations').select('*').eq('deal_id', dealId);
      if (error) throw error;
      return (data ?? []).map((r) => ({ dealId: r.deal_id, userId: r.user_id, lat: Number(r.lat), lng: Number(r.lng), at: Date.parse(r.updated_at) }));
    },

    async savePushToken(t: PushTokenRow): Promise<void> {
      const { error } = await db.from('push_tokens').upsert(
        { user_id: t.userId, expo_token: t.token, platform: t.platform ?? null },
        { onConflict: 'user_id,expo_token' }
      );
      if (error) throw error;
    },

    async getPushTokens(userId: string): Promise<string[]> {
      const { data, error } = await db.from('push_tokens').select('expo_token').eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.expo_token);
    },

    async createInvite(inv: InviteRow): Promise<void> {
      const { error } = await db.from('invites').insert({
        token: inv.token,
        inviter_id: inv.inviterId,
        inviter_role: inv.inviterRole,
        invitee_phone: inv.inviteePhone,
        item_description: inv.itemDescription,
        amount_cents: inv.amountCents,
        status: inv.status,
        deal_id: inv.dealId,
      });
      if (error) throw error;
    },

    async getInvite(token: string): Promise<InviteRow | null> {
      const { data, error } = await db.from('invites').select('*').eq('token', token).maybeSingle();
      if (error) throw error;
      return data ? rowToInvite(data) : null;
    },

    async listPendingInvitesForPhone(phone: string): Promise<InviteRow[]> {
      const { data, error } = await db.from('invites').select('*').eq('invitee_phone', phone).eq('status', 'pending');
      if (error) throw error;
      return (data ?? []).map(rowToInvite);
    },

    async markInviteAccepted(token: string, dealId: string): Promise<void> {
      const { error } = await db.from('invites').update({ status: 'accepted', deal_id: dealId, accepted_at: new Date().toISOString() }).eq('token', token);
      if (error) throw error;
    },

    async cancelInvite(token: string): Promise<void> {
      const { error } = await db.from('invites').update({ status: 'cancelled' }).eq('token', token);
      if (error) throw error;
    },

    async setKyc(id: string, tier: 'phone' | 'id_verified', status: 'none' | 'pending' | 'verified' | 'rejected'): Promise<void> {
      const { error } = await db.from('users').update({ identity_tier: tier, kyc_status: status }).eq('id', id);
      if (error) throw error;
    },

    async setCardOnFile(userId: string, last4: string): Promise<void> {
      const { error } = await db.from('users').update({ has_card_on_file: true, card_last4: last4 }).eq('id', userId);
      if (error) throw error;
    },

    async setSellerHold(dealId: string, holdId: string | null): Promise<void> {
      const { error } = await db.from('deals').update({ seller_hold_id: holdId }).eq('id', dealId);
      if (error) throw error;
    },

    async addMessage(dealId: string, senderId: string, body: string): Promise<void> {
      const { error } = await db.from('messages').insert({ deal_id: dealId, sender_id: senderId, body });
      if (error) throw error;
    },
    async listMessages(dealId: string): Promise<{ senderId: string; body: string; createdAt: number }[]> {
      const { data, error } = await db.from('messages').select('sender_id, body, created_at').eq('deal_id', dealId).order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((m: any) => ({ senderId: m.sender_id, body: m.body, createdAt: Date.parse(m.created_at) }));
    },

    async blockUser(blockerId: string, blockedId: string): Promise<void> {
      const { error } = await db.from('blocks').upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });
      if (error) throw error;
    },
    async isBlocked(a: string, b: string): Promise<boolean> {
      const { data, error } = await db.from('blocks').select('blocker_id').or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async listBlocked(blockerId: string): Promise<{ id: string; name: string }[]> {
      const { data, error } = await db.from('blocks').select('blocked_id').eq('blocker_id', blockerId);
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.blocked_id as string);
      if (ids.length === 0) return [];
      const { data: users, error: uErr } = await db.from('users').select('id, name').in('id', ids);
      if (uErr) throw uErr;
      const names = new Map((users ?? []).map((u: any) => [u.id as string, u.name as string]));
      return ids.map((id) => ({ id, name: names.get(id) ?? 'Unknown' }));
    },
    async unblockUser(blockerId: string, blockedId: string): Promise<void> {
      const { error } = await db.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId);
      if (error) throw error;
    },
    async reportUser(r: { reporterId: string; reportedId: string; dealId: string | null; reason: string }): Promise<void> {
      const { error } = await db.from('reports').insert({ reporter_id: r.reporterId, reported_id: r.reportedId, deal_id: r.dealId, reason: r.reason });
      if (error) throw error;
    },
  };
}

function rowToInvite(r: Record<string, any>): InviteRow {
  return {
    token: r.token,
    inviterId: r.inviter_id,
    inviterRole: r.inviter_role,
    inviteePhone: r.invitee_phone,
    itemDescription: r.item_description,
    amountCents: Number(r.amount_cents),
    status: r.status,
    dealId: r.deal_id,
    createdAt: Date.parse(r.created_at),
  };
}

function rowToTransfer(r: Record<string, any>): TransferRow {
  return {
    dealId: r.deal_id,
    provider: r.provider,
    providerRef: r.provider_ref,
    rail: r.rail,
    direction: r.direction,
    amountCents: Number(r.amount_cents),
    status: r.status,
    riskScore: r.risk_score != null ? Number(r.risk_score) : null,
    idempotencyKey: r.idempotency_key,
  };
}
