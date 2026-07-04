import { describe, it, expect } from 'vitest';
import { balanceOf, escrowAcct, bankAcct, type Action } from '@meetme/core';
import { makeServerCtx } from './ctx';
import { makeSupabaseRepo } from './supabaseRepo';
import { signup } from './signup';
import { createDealHandler, handleAction, type HandlerResult } from './handler';
import { FakeRail } from './rails/fakeRail';
import { submitLocation } from './location';

// Runs ONLY when pointed at a live Supabase (local or hosted). `npm test` skips it.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run smoke
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN = !!URL && !!KEY;

const ok = (r: HandlerResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r;
};

(RUN ? describe : describe.skip)('M1 smoke against a live Supabase', () => {
  it('drives one real marketplace deal DRAFT -> RELEASED in Postgres, ledger conserves', async () => {
    const repo = makeSupabaseRepo(URL!, KEY!);
    const ctx = makeServerCtx();
    const suffix = Math.floor(Math.random() * 1e9); // unique phones per run

    const b = await signup(repo, { phone: `+1555${suffix}1`, name: 'Maya Chen', isVoip: false }, ctx);
    const s = await signup(repo, { phone: `+1555${suffix}2`, name: 'Sam Rivera', isVoip: false }, ctx);
    if (!b.ok || !s.ok) throw new Error('signup failed');

    const created = await createDealHandler(repo, { creatorUserId: b.user.id, counterpartyUserId: s.user.id, itemDescription: 'iPhone 12', amountCents: 300_00 }, ctx);
    if (!created.ok) throw new Error('create failed: ' + created.reason);
    const dealId = created.deal.id;

    const user = (id: string, action: Action) => handleAction(repo, { dealId, action, callerUserId: id, channel: 'user' }, ctx);
    ok(await user(s.user.id, { type: 'ACCEPT_TERMS' }));
    ok(await user(b.user.id, { type: 'FUND' }));
    ok(await user(s.user.id, { type: 'POST_STAKE' }));
    ok(await user(b.user.id, { type: 'HEAD_OUT', actor: 'buyer' }));

    // M4 geofence: both phones come together -> auto AT_MEETUP (exercises the
    // deal_locations table + the CO_LOCATED commit against live Postgres)
    const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
    await submitLocation(repo, rail, { dealId, userId: b.user.id, lat: 40.7128, lng: -74.006 }, ctx);
    const colo = await submitLocation(repo, rail, { dealId, userId: s.user.id, lat: 40.71283, lng: -74.00605 }, ctx);
    expect(colo.ok && colo.state).toBe('AT_MEETUP');

    const revealed = ok(await user(b.user.id, { type: 'REVEAL_CODE' }));
    const code = revealed.secret!.releaseCode; // minted at reveal, delivered to the buyer only
    ok(await user(s.user.id, { type: 'ENTER_CODE', code }));
    ok(await user(b.user.id, { type: 'CONFIRM_RECEIVED' }));

    const rec = await repo.getDeal(dealId);
    expect(rec!.deal.state).toBe('RELEASED');

    // pull the persisted ledger straight from Postgres and check conservation
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const { data: legs } = await db.from('ledger_entries').select('account,amount_cents').eq('deal_id', dealId);
    const rows = (legs ?? []).map((l: any) => ({ txnId: '', account: l.account, amountCents: Number(l.amount_cents), dealId, memo: '' }));
    expect(rows.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0); // whole deal nets 0
    expect(balanceOf(rows, escrowAcct(dealId))).toBe(0); // escrow drained
    expect(balanceOf(rows, bankAcct(s.user.id))).toBe(300_00 - 4_00); // seller +$296

    expect((await repo.getUser(b.user.id))!.completedDeals).toBe(1);
    expect((await repo.getUser(s.user.id))!.completedDeals).toBe(1);
  });
});
