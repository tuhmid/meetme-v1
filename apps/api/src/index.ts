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

const app = buildServer({
  repo: makeSupabaseRepo(url, key),
  rail: new FakeRail({ fundingRail: 'rtp', instantSettle: true }),
  makeCtx: () => makeServerCtx(),
  // Real Supabase-JWT verification is wired; the dev bearer shortcut stays on for demos.
  verifyToken: anon ? makeSupabaseTokenVerifier(url, anon) : undefined,
  push: makeExpoPushSender(),
  mapsKey: process.env.GEOAPIFY_KEY,
  allowDev: true,
});

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`MeetMe API on http://localhost:${port}  (rail: FakeRail/RTP, db: local Supabase)`);
});
