# splitpro-mcp

An MCP server that lets you drive a [SplitPro](https://github.com/oss-apps/split-pro)
instance (an open-source Splitwise alternative) by talking to an agent like Claude.
Single-operator by design: one Personal Access Token = one user; the agent acts as you.

## Tools

| Tool | What it does |
|------|--------------|
| `list_groups` | Your groups + your net balance in each |
| `get_balances` | Who owes whom (overall, or focused on one friend) |
| `list_expenses` | Recent expenses (all, by group, or with a friend) |
| `search_expenses` | Filter expenses by text / category / date range |
| `add_expense` | Add an expense — **preview first, then confirm** |
| `settle_up` | Record a payment — **preview first, then confirm** |
| `create_group` | Create a group |
| `add_member` | Add an existing friend to a group |

### Write safety
`add_expense` and `settle_up` return a **PREVIEW** (resolved people + computed
per-person split) unless called with `confirm=true`. The preview includes an
`idempotency_key`; passing that same key on the confirm call makes the write
**idempotent** — a retry can never create a duplicate expense (enforced by a
unique DB constraint on the SplitPro side).

Split types supported: `EQUAL`, `EXACT`, `PERCENTAGE`, `SHARE`, `ADJUSTMENT`.
Amounts are in major units (e.g. `63.40`); the server stores exact BigInt minor units.

## Setup

```bash
npm install
npm run build
```

Get a token from your SplitPro instance:

```bash
# in the split-pro repo:
pnpm tsx --env-file=.env scripts/create-api-token.ts \
  --email you@example.com --scope read_write --name "MCP"
```

## Connect to Claude Code

Add to `.mcp.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "splitpro": {
      "command": "node",
      "args": ["/Users/joem4air/Downloads/splitwise-agent/splitpro-mcp/dist/index.js"],
      "env": {
        "SPLITPRO_URL": "http://localhost:3000",
        "SPLITPRO_TOKEN": "spat_your_token_here"
      }
    }
  }
}
```

Then just talk: *"I paid €40 for dinner, split equally with Nathen and Maverick"*,
*"what does Stanley owe me?"*, *"settle up €20 with Emma"*.

## Test

```bash
SPLITPRO_TOKEN=spat_... npx tsx test/run.ts     # API-level E2E (reads, writes, idempotency, splits)
SPLITPRO_TOKEN=spat_... npx tsx test/stdio.ts    # real MCP protocol round-trip
```

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `SPLITPRO_URL` | `http://localhost:3000` | Base URL of your SplitPro instance |
| `SPLITPRO_TOKEN` | _(required)_ | A `spat_…` Personal Access Token |

The token is read-or-read_write scoped. A `read` token is rejected on any write
tool (the server returns `FORBIDDEN`). Tokens are rate-limited (60 req/min).
