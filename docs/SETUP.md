# Splitwise-equivalent — local build

A working, agent-accessible Splitwise alternative:

- **`split-pro/`** — fork of [oss-apps/split-pro](https://github.com/oss-apps/split-pro)
  (Next.js + tRPC + Prisma + Postgres). Web + Android PWA. Patched with:
  - Personal Access Token (Bearer) auth for programmatic access (`src/server/apiToken.ts`,
    minimal patch to `src/server/api/trpc.ts`) — read / read_write scopes, rate-limited.
  - Idempotent expense/settlement creation (`IdempotencyRecord` model + `splitService.ts`).
  - Email notifications on expense activity (`notificationService.ts` + `mailer.ts`).
  - Token issuance CLI: `scripts/create-api-token.ts`.
- **`splitpro-mcp/`** — MCP server exposing the API as 8 agent tools. See its README.

## Stack chosen for this machine

- **Node 22** (`brew install node@22`; the repo pins 22.16, Node 25 breaks Prisma engines).
- **Postgres 17 native** (`brew install postgresql@17`) — no Docker on this box.
- **pg_cron dev stub**: the native Postgres has no pg_cron, and building it from source
  hit macOS toolchain issues. Since pg_cron only drives cache-cleanup + recurrence
  *scheduling* (recurrence data/notifications work without it), a SQL-only fake
  `pg_cron` extension is installed so SplitPro's migrations run **unmodified**:
  `/opt/homebrew/share/postgresql@17/extension/pg_cron*`. Background firing is inert in
  dev; in production use a real pg_cron image (SplitPro ships `docker/postgres`).
- **mailpit** (`brew install mailpit`) — local SMTP catcher (SMTP :1025, UI :8025) so
  magic-link login and expense-notification emails are visible.

## Reproduce from scratch

```bash
# 1. tools
brew install node@22 postgresql@17 mailpit
brew services start postgresql@17
brew services start mailpit
/opt/homebrew/opt/node@22/bin/npm i -g pnpm@10.11.0   # use node@22

# 2. db role + database
psql -d postgres -c "CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'strong-password';"
createdb -O postgres splitpro

# 3. fake pg_cron extension  (see split-pro/docker if you want the real thing)
#    files already created under $(pg_config --sharedir)/extension/pg_cron*

# 4. app
cd split-pro
cp .env.example .env    # then set DATABASE_URL, NEXTAUTH_SECRET, EMAIL_SERVER_HOST=localhost,
                        # EMAIL_SERVER_PORT=1025, CURRENCY_RATE_PROVIDER=frankfurter
pnpm install
pnpm prisma migrate deploy
pnpm db:seed

# 5. IMPORTANT: the seed inserts explicit ids; resync sequences or group.create collides
psql -d splitpro -c "SELECT setval(pg_get_serial_sequence('\"User\"','id'), (SELECT MAX(id) FROM \"User\"));"
psql -d splitpro -c "SELECT setval(pg_get_serial_sequence('\"Group\"','id'), (SELECT MAX(id) FROM \"Group\"));"

# 6. run
pnpm dev    # http://localhost:3000

# 7. issue an API token for the MCP server
pnpm tsx --env-file=.env scripts/create-api-token.ts --email ava.white@example.com --scope read_write --name MCP
```

All commands assume `node@22` + `postgresql@17` on PATH:
`export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"`

## What was verified (all green)

- 26 SplitPro migrations apply on native PG17 via the fake pg_cron extension.
- Seed: 150 users / 150 groups / 17.8k expenses / 66k participants / 8k balance rows.
- Bearer auth: valid token → data; no token → 401; **read-scoped token → 403 on mutations**.
- MCP: all 8 tools work over the real MCP stdio protocol (reads + preview/confirm writes).
- Idempotency: a retried confirm returns the **same** expense id; DB shows 1 row per key.
- Split math: EQUAL / EXACT etc. — every created expense's participants sum to exactly 0.
- Email: expense + settle-up notifications delivered to mailpit with correct subjects.
- `tsc --noEmit` clean on both the fork and the MCP package.

## Not done here (needs your accounts)

Production deploy (Fly/Railway + managed Postgres-with-pg_cron + domain + backups) and
the optional upstream PR of the PAT feature. See the build summary for the cut scope
(no Plaid / Venmo / OCR per your decision; email notifications kept).
