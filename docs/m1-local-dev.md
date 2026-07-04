# M1 — local dev (Supabase on Docker)

The whole backend runs locally: Postgres + Auth + Realtime + a Studio UI, in Docker,
free and offline. This is the dev loop until you spin up a hosted project.

## Prereqs
- Docker Desktop **running** (whale icon steady).
- Supabase CLI (`brew install supabase/tap/supabase`).
- Note: this machine's `docker` CLI symlink is stale (points at the installer DMG),
  so the `db:*` npm scripts prepend the real Docker binary
  (`/Applications/Docker.app/Contents/Resources/bin`) and set `DOCKER_HOST`. If you
  update/repair Docker Desktop, the plain `supabase` CLI will work without that.

## Commands
```bash
npm run db:start   # boot the stack + apply db/migrations (via supabase/migrations)
npm run db:studio  # http://127.0.0.1:54323 — browse tables, run SQL
npm run smoke      # drive one real deal DRAFT->RELEASED through Postgres (.env)
npm run db:reset   # drop + reapply all migrations (fresh DB)
npm run db:stop    # stop the stack (data persists across stop/start)
```

## Local keys (`.env`)
`db:start` prints an `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY`. These are the
**shared local-dev defaults** (safe, local only). They're already in `.env`
(gitignored). The `SERVICE_ROLE_KEY` bypasses RLS and is for the server only.

## Migrations
SQL lives in `db/migrations/` (source of truth) and is copied to
`supabase/migrations/<timestamp>_*.sql` (what the CLI applies):
1. schema · 2. RLS · 3. ledger balance trigger · 4. `apply_transition` RPC · 5. grants.
Edit in `db/migrations/`, re-copy to `supabase/migrations/`, then `npm run db:reset`.

## Going hosted later
Same migrations apply to a cloud project (`supabase db push` or paste in the SQL
editor); swap `.env` to the hosted URL + keys. See `m1-supabase-wiring.md` for the
service-role client, the HTTP/Edge entry point, and Realtime.
