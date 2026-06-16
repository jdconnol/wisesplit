#!/usr/bin/env node
/**
 * SplitPro MCP server (stdio). Exposes a small set of tools over a SplitPro
 * instance using a Personal Access Token. Single-operator by design: the token
 * identifies one user; the agent acts as that user.
 *
 * Config (env): SPLITPRO_URL (default http://localhost:3000), SPLITPRO_TOKEN (required).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { SplitProApi } from './api.js';

const baseUrl = process.env.SPLITPRO_URL ?? 'http://localhost:3000';
const token = process.env.SPLITPRO_TOKEN;
if (!token) {
  console.error('FATAL: SPLITPRO_TOKEN environment variable is required.');
  process.exit(1);
}

const api = new SplitProApi(baseUrl, token);
const server = new McpServer({ name: 'splitpro-mcp', version: '0.1.0' });

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});
const run = async (fn: () => Promise<string>) => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
};

const SPLIT_TYPES = ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARE', 'ADJUSTMENT'] as const;

// ---- read tools ----

server.registerTool(
  'list_groups',
  { description: 'List your groups with your net balance in each.', inputSchema: {} },
  () => run(() => api.listGroups()),
);

server.registerTool(
  'get_balances',
  {
    description: 'Get who owes whom. Optionally pass a person name to focus on one friend.',
    inputSchema: { person: z.string().optional().describe('Friend name/email to focus on') },
  },
  ({ person }) => run(() => api.getBalances(person)),
);

server.registerTool(
  'list_expenses',
  {
    description: 'List recent expenses, optionally within a group or with a friend.',
    inputSchema: {
      group: z.string().optional(),
      friend: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
  },
  ({ group, friend, limit }) => run(() => api.listExpenses({ group, friend, limit })),
);

server.registerTool(
  'search_expenses',
  {
    description: 'Search expenses by text, category, and/or date range (YYYY-MM-DD).',
    inputSchema: {
      query: z.string().optional(),
      category: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
  },
  ({ query, category, from, to, limit }) =>
    run(() => api.searchExpenses({ query, category, from, to, limit })),
);

// ---- write tools (preview unless confirm=true) ----

server.registerTool(
  'add_expense',
  {
    description:
      'Add an expense. Without confirm=true it returns a PREVIEW with computed splits and an idempotency_key; ' +
      'call again with confirm=true and that same idempotency_key to save. Specify either `group` or `friend`.',
    inputSchema: {
      description: z.string(),
      amount: z.number().positive().describe('Amount in major units, e.g. 63.40'),
      currency: z.string().optional(),
      paid_by: z.string().optional().describe('Who paid (default: you)'),
      group: z.string().optional(),
      friend: z.string().optional(),
      split_type: z.enum(SPLIT_TYPES).optional().describe('Default EQUAL'),
      shares: z
        .record(z.string(), z.number())
        .optional()
        .describe('Per-person share: percent for PERCENTAGE, weight for SHARE, amount for EXACT/ADJUSTMENT'),
      date: z.string().optional().describe('YYYY-MM-DD'),
      category: z.string().optional(),
      confirm: z.boolean().optional(),
      idempotency_key: z.string().optional(),
    },
  },
  (a) =>
    run(() =>
      api.addExpense({
        description: a.description,
        amount: a.amount,
        currency: a.currency,
        paidBy: a.paid_by,
        group: a.group,
        friend: a.friend,
        splitType: a.split_type,
        shares: a.shares,
        date: a.date,
        category: a.category,
        confirm: a.confirm,
        idempotencyKey: a.idempotency_key,
      }),
    ),
);

server.registerTool(
  'settle_up',
  {
    description:
      'Record a payment between two people. Without confirm=true returns a PREVIEW with an idempotency_key; ' +
      'call again with confirm=true and that key to save.',
    inputSchema: {
      from: z.string().optional().describe('Payer (default: you)'),
      to: z.string().describe('Payee'),
      amount: z.number().positive(),
      currency: z.string().optional(),
      group: z.string().optional(),
      confirm: z.boolean().optional(),
      idempotency_key: z.string().optional(),
    },
  },
  (a) =>
    run(() =>
      api.settleUp({
        from: a.from,
        to: a.to,
        amount: a.amount,
        currency: a.currency,
        group: a.group,
        confirm: a.confirm,
        idempotencyKey: a.idempotency_key,
      }),
    ),
);

server.registerTool(
  'create_group',
  { description: 'Create a new group.', inputSchema: { name: z.string() } },
  ({ name }) => run(() => api.createGroup(name)),
);

server.registerTool(
  'add_member',
  {
    description: 'Add an existing friend to a group.',
    inputSchema: { group: z.string(), person: z.string() },
  },
  ({ group, person }) => run(() => api.addMember(group, person)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('splitpro-mcp connected via stdio');
