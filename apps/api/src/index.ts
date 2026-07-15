import { FakeRail, makeExpoPushSender, makeServerCtx, makeSupabaseRepo, makeSupabaseTokenVerifier } from '@meetme/server';
import { buildServer } from './server';

// Boot the API against the live (local) Supabase + a FakeRail (test-mode money).
// Run: `npm run api:dev` from the repo root (loads .env, runs via tsx).
// Swap FakeRail -> makePlaidRail(...) once you have Plaid sandbox creds (docs/m2-plaid-setup.md).
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env). Did you run `npm run db:start`?');
  process.exit(1);
}

const allowDev = process.env.ALLOW_DEV === '1';

// Hard stop: the dev backdoor (`dev:<userId>` impersonation + UNAUTHENTICATED /dev/* settle /
// return / resolve) would be a total compromise if it ever shipped enabled. Refuse to boot in
// production rather than silently expose it.
if (allowDev && process.env.NODE_ENV === 'production') {
  console.error('FATAL: ALLOW_DEV=1 with NODE_ENV=production. The dev backdoor lets anyone impersonate users and move money. Refusing to boot.');
  process.exit(1);
}

const app = buildServer({
  repo: makeSupabaseRepo(url, key),
  rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }),
  makeCtx: () => makeServerCtx(),
  // Real Supabase-JWT verification is wired; the dev bearer shortcut + /dev routes are
  // OFF unless ALLOW_DEV=1 (local only). Never enable in a reachable/production env —
  // they permit `dev:<userId>` impersonation and unauthenticated settle/resolve.
  verifyToken: anon ? makeSupabaseTokenVerifier(url, anon) : undefined,
  push: makeExpoPushSender(),
  mapsKey: process.env.GEOAPIFY_KEY,
  allowDev,
});

const port = Number(process.env.PORT ?? 8787);
// 0.0.0.0 by default so a physical device can reach the API over the LAN during dev; set HOST
// (e.g. 127.0.0.1) in any shared environment. Warn loudly on the reachable + backdoor combo.
const host = process.env.HOST ?? '0.0.0.0';
if (allowDev && host === '0.0.0.0') {
  console.warn('⚠ ALLOW_DEV=1 and bound to 0.0.0.0 — the dev backdoor is reachable by anyone on this network. LOCAL DEV ONLY.');
}
app.listen({ port, host }).then(() => {
  console.log(`MeetMe API on http://localhost:${port}  (rail: FakeRail/RTP, db: local Supabase)`);
});
