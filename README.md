<p align="center"><img src="web/assets/logo.svg" width="64" alt="WiseSplit"></p>
<h1 align="center">WiseSplit</h1>
<p align="center">Split expenses by talking to your AI. An open-source, self-hosted Splitwise alternative with an MCP connector.</p>

---

WiseSplit is two things:

- **`app/`** — the WiseSplit server: a fork of [SplitPro](https://github.com/oss-apps/split-pro)
  (Next.js + tRPC + Prisma + Postgres). A full expense-splitting app — groups, every split
  type, balances, settle-up, recurring, multi-currency, push + email notifications. Installs
  on Android & iOS as a PWA. Patched with **Personal Access Token auth**, **idempotent writes**,
  and **expense email notifications**.
- **`mcp/`** — the WiseSplit MCP connector: a small server exposing 8 tools so an AI agent
  (Claude or any MCP client) can add expenses, settle up, check balances, and manage groups
  in plain language. Writes are previewed and idempotent.

Plus **`web/`** (the landing page + docs site), **`android/`** (a TWA project to build a
signed APK once deployed), and **`docs/`**.

## Quick start

```bash
# 1. server
cd app && cp .env.example .env   # set DATABASE_URL, NEXTAUTH_SECRET, EMAIL_SERVER_*, CURRENCY_RATE_PROVIDER=frankfurter
pnpm install && pnpm prisma migrate deploy && pnpm dev

# 2. token
pnpm tsx --env-file=.env scripts/create-api-token.ts --email you@example.com --scope read_write --name MCP

# 3. connector
cd ../mcp && npm install && npm run build
# add to your MCP client with SPLITPRO_URL + SPLITPRO_TOKEN (see web/docs.html)
```

Then talk to your agent: *“add €40 dinner split with Nathen and Maverick”*, *“what do I owe?”*.

## Repo layout

| Path | What |
|------|------|
| `app/` | WiseSplit server (SplitPro fork + patches) |
| `mcp/` | MCP connector (`wisesplit-mcp`) |
| `web/` | Landing page + documentation site |
| `android/` | TWA project + `build-apk.sh` for a signed Android APK |
| `docs/` | Setup notes |

## License

MIT. Built on [SplitPro](https://github.com/oss-apps/split-pro) (MIT) — see `app/LICENSE`.
