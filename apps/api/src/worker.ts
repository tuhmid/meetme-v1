import { FakeRail, makeServerCtx, makeSupabaseRepo, runWorkerOnce } from '@meetme/server';

// Background worker: periodically syncs funding settlement and fires due timed
// transitions (no-show expiry, confirm-window auto-release). Run alongside the API:
//   npm run worker:dev   (from the repo root)
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env). Did you run `npm run db:start`?');
  process.exit(1);
}

const repo = makeSupabaseRepo(url, key);
const rail = new FakeRail({ fundingRail: 'rtp', instantSettle: true });
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);

async function tick(): Promise<void> {
  try {
    const s = await runWorkerOnce(repo, rail, () => makeServerCtx());
    if (s.settled || s.expired || s.released) {
      console.log(`[worker] scanned ${s.scanned} · settled ${s.settled} · expired ${s.expired} · released ${s.released}`);
    }
  } catch (e) {
    console.error('[worker] error', e);
  }
}

console.log(`MeetMe worker: scanning every ${INTERVAL_MS}ms (db: local Supabase, rail: FakeRail/RTP)`);
void tick();
setInterval(() => void tick(), INTERVAL_MS);
