/**
 * SplitProApi — the testable core behind the MCP tools. Each method returns a
 * human/agent-readable string. index.ts registers thin MCP tools over these.
 */
import { randomUUID } from 'crypto';

import { SplitProClient } from './client.js';
import { formatMoney, toMinorUnits } from './money.js';
import { computeSplit, type SplitType } from './split.js';
import { resolvePerson, type Candidate } from './resolve.js';

interface User {
  id: number;
  name: string | null;
  email: string | null;
  currency?: string;
}

interface NormalizedGroup {
  id: number;
  name: string;
  members: Candidate[];
  balances?: Record<string, bigint>;
}

export interface AddExpenseInput {
  description: string;
  amount: number;
  currency?: string;
  paidBy?: string;
  group?: string;
  friend?: string;
  splitType?: SplitType;
  shares?: Record<string, number>;
  date?: string;
  category?: string;
  confirm?: boolean;
  idempotencyKey?: string;
}

export interface SettleUpInput {
  from?: string;
  to: string;
  amount: number;
  currency?: string;
  group?: string;
  confirm?: boolean;
  idempotencyKey?: string;
}

export class SplitProApi {
  private client: SplitProClient;
  private meCache?: User;

  constructor(baseUrl: string, token: string) {
    this.client = new SplitProClient(baseUrl, token);
  }

  async me(): Promise<User> {
    if (!this.meCache) {
      this.meCache = await this.client.query<User>('user.me');
    }
    return this.meCache;
  }

  async friends(): Promise<Candidate[]> {
    const users = await this.client.query<User[]>('user.getFriends');
    return users.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  private async groups(): Promise<NormalizedGroup[]> {
    // group.getAllGroups returns the caller's memberships, each embedding the group
    // (with groupUsers -> user). Be defensive about the exact nesting.
    const raw = await this.client.query<unknown[]>('group.getAllGroups');
    return raw.map((item) => {
      const it = item as Record<string, unknown>;
      const g = (it.group ?? it) as Record<string, unknown>;
      const gu = (g.groupUsers ?? []) as Array<Record<string, unknown>>;
      const members: Candidate[] = gu.map((m) => {
        const u = (m.user ?? m) as Record<string, unknown>;
        return { id: u.id as number, name: (u.name as string) ?? null, email: (u.email as string) ?? null };
      });
      return { id: g.id as number, name: (g.name as string) ?? '(unnamed)', members };
    });
  }

  private async resolveGroup(query: string): Promise<NormalizedGroup> {
    const groups = await this.groups();
    const q = query.trim().toLowerCase();
    if (/^\d+$/.test(q)) {
      const byId = groups.find((g) => g.id === Number(q));
      if (byId) return byId;
    }
    const exact = groups.filter((g) => g.name.toLowerCase() === q);
    if (exact.length === 1) return exact[0]!;
    const partial = groups.filter((g) => g.name.toLowerCase().includes(q));
    if (partial.length === 1) return partial[0]!;
    if (partial.length === 0) throw new Error(`No group matching "${query}".`);
    throw new Error(`"${query}" is ambiguous — groups: ${partial.map((g) => g.name).join(', ')}.`);
  }

  // ---------------------------------------------------------------- reads

  async listGroups(): Promise<string> {
    const groups = await this.client.query<Array<Record<string, unknown>>>(
      'group.getAllGroupsWithBalances',
      { getArchived: false },
    );
    if (!groups.length) return 'No groups yet.';
    const lines = groups.map((g) => {
      const balances = (g.balances ?? {}) as Record<string, bigint>;
      const balStr =
        Object.entries(balances)
          .filter(([, v]) => v !== 0n)
          .map(([cur, v]) => formatMoney(v as bigint, cur))
          .join(', ') || 'settled up';
      const memberCount = Array.isArray(g.groupUsers) ? (g.groupUsers as unknown[]).length : undefined;
      return `• ${g.name as string} (id ${g.id as number}${memberCount ? `, ${memberCount} members` : ''}) — your balance: ${balStr}`;
    });
    return `Groups:\n${lines.join('\n')}`;
  }

  async getBalances(person?: string): Promise<string> {
    const me = await this.me();
    const cumulated = await this.client.query<{
      youOwe: Array<{ currency: string; amount: bigint }>;
      youGet: Array<{ currency: string; amount: bigint }>;
    }>('expense.getCumulatedBalances');
    const perFriend = await this.client.query<{
      balances: Array<{
        friendId: number;
        friend: User;
        currencies: Array<{ currency: string; amount: bigint }>;
      }>;
    }>('expense.getBalances');

    let friendBalances = perFriend.balances;
    if (person) {
      const friends = await this.friends();
      const id = resolvePerson(person, friends, me.id);
      friendBalances = friendBalances.filter((b) => b.friendId === id);
    }

    const owe = cumulated.youOwe.filter((x) => x.amount !== 0n).map((x) => formatMoney(x.amount, x.currency));
    const get = cumulated.youGet.filter((x) => x.amount !== 0n).map((x) => formatMoney(x.amount, x.currency));

    const header = person
      ? `Balance with ${person}:`
      : `Overall — you are owed: ${get.join(', ') || 'nothing'}; you owe: ${owe.join(', ') || 'nothing'}`;

    const lines = friendBalances.map((b) => {
      const name = b.friend?.name ?? b.friend?.email ?? `user ${b.friendId}`;
      const detail = b.currencies
        .filter((c) => c.amount !== 0n)
        .map((c) => {
          const verb = c.amount > 0n ? 'owes you' : 'you owe';
          return `${verb} ${formatMoney(c.amount > 0n ? c.amount : -c.amount, c.currency)}`;
        })
        .join(', ');
      return `• ${name}: ${detail || 'settled up'}`;
    });

    return [header, ...lines].join('\n');
  }

  async listExpenses(opts: { group?: string; friend?: string; limit?: number }): Promise<string> {
    const me = await this.me();
    const limit = opts.limit ?? 15;
    let rows: Array<{ name: string; amount: bigint; currency: string; date?: string; paidBy?: string; yourShare?: bigint }> = [];

    if (opts.group) {
      const g = await this.resolveGroup(opts.group);
      const expenses = await this.client.query<Array<Record<string, unknown>>>('expense.getGroupExpenses', {
        groupId: g.id,
      });
      rows = expenses
        .filter((e) => !e.deletedAt)
        .map((e) => ({
          name: e.name as string,
          amount: e.amount as bigint,
          currency: e.currency as string,
          date: (e.expenseDate as string) ?? undefined,
          paidBy: ((e.paidByUser as Record<string, unknown>)?.name as string) ?? undefined,
        }));
    } else if (opts.friend) {
      const friends = await this.friends();
      const id = resolvePerson(opts.friend, friends, me.id);
      const expenses = await this.client.query<Array<Record<string, unknown>>>('expense.getExpensesWithFriend', {
        friendId: id,
      });
      rows = expenses
        .filter((e) => !e.deletedAt)
        .map((e) => ({
          name: e.name as string,
          amount: e.amount as bigint,
          currency: e.currency as string,
          date: (e.expenseDate as string) ?? undefined,
          paidBy: ((e.paidByUser as Record<string, unknown>)?.name as string) ?? undefined,
        }));
    } else {
      const parts = await this.client.query<Array<Record<string, unknown>>>('expense.getAllExpenses');
      rows = parts
        .map((p) => ({ p, e: p.expense as Record<string, unknown> }))
        .filter(({ e }) => e && !e.deletedAt)
        .map(({ p, e }) => ({
          name: e.name as string,
          amount: e.amount as bigint,
          currency: e.currency as string,
          date: (e.expenseDate as string) ?? undefined,
          paidBy: ((e.paidByUser as Record<string, unknown>)?.name as string) ?? undefined,
          yourShare: p.amount as bigint,
        }));
    }

    if (!rows.length) return 'No expenses found.';
    const shown = rows.slice(0, limit);
    const lines = shown.map((r) => {
      const d = r.date ? new Date(r.date).toISOString().slice(0, 10) : '';
      const share = r.yourShare !== undefined ? ` [your share: ${formatMoney(r.yourShare, r.currency)}]` : '';
      const paid = r.paidBy ? ` — paid by ${r.paidBy}` : '';
      return `• ${d} ${r.name}: ${formatMoney(r.amount, r.currency)}${paid}${share}`;
    });
    const more = rows.length > limit ? `\n… and ${rows.length - limit} more` : '';
    return `Expenses (${shown.length} of ${rows.length}):\n${lines.join('\n')}${more}`;
  }

  async searchExpenses(opts: {
    query?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<string> {
    const parts = await this.client.query<Array<Record<string, unknown>>>('expense.getAllExpenses');
    const q = opts.query?.toLowerCase();
    const from = opts.from ? new Date(opts.from) : undefined;
    const to = opts.to ? new Date(opts.to) : undefined;

    const matched = parts
      .map((p) => ({ p, e: p.expense as Record<string, unknown> }))
      .filter(({ e }) => {
        if (!e || e.deletedAt) return false;
        if (q && !(e.name as string).toLowerCase().includes(q)) return false;
        if (opts.category && (e.category as string)?.toLowerCase() !== opts.category.toLowerCase()) return false;
        const d = e.expenseDate ? new Date(e.expenseDate as string) : undefined;
        if (from && d && d < from) return false;
        if (to && d && d > to) return false;
        return true;
      });

    if (!matched.length) return 'No matching expenses.';
    const limit = opts.limit ?? 20;
    const lines = matched.slice(0, limit).map(({ p, e }) => {
      const d = e.expenseDate ? new Date(e.expenseDate as string).toISOString().slice(0, 10) : '';
      return `• ${d} ${e.name as string} (${e.category as string}): ${formatMoney(e.amount as bigint, e.currency as string)} [your share: ${formatMoney(p.amount as bigint, e.currency as string)}]`;
    });
    const more = matched.length > limit ? `\n… and ${matched.length - limit} more` : '';
    return `Found ${matched.length} expense(s):\n${lines.join('\n')}${more}`;
  }

  // ---------------------------------------------------------------- writes

  async addExpense(input: AddExpenseInput): Promise<string> {
    const me = await this.me();
    const currency = (input.currency ?? me.currency ?? 'USD').toUpperCase();
    const amount = toMinorUnits(input.amount, currency);
    if (amount <= 0n) throw new Error('Amount must be positive.');
    const splitType: SplitType = input.splitType ?? 'EQUAL';

    // Resolve the people involved and the payer.
    let participantIds: number[];
    let groupId: number | null = null;
    let candidates: Candidate[];

    if (input.group) {
      const g = await this.resolveGroup(input.group);
      groupId = g.id;
      candidates = g.members;
      participantIds = g.members.map((m) => m.id);
    } else if (input.friend) {
      const friends = await this.friends();
      candidates = [...friends, { id: me.id, name: me.name ?? 'me', email: me.email }];
      const friendId = resolvePerson(input.friend, friends, me.id);
      participantIds = [me.id, friendId];
    } else {
      throw new Error('Specify either a `group` or a `friend` for the expense.');
    }

    const paidById = resolvePerson(input.paidBy ?? 'me', candidates, me.id);
    if (!participantIds.includes(paidById)) participantIds.push(paidById);

    // Convert shares (keyed by name) into the unit each split type wants.
    const shares: Record<number, bigint> = {};
    if (input.shares) {
      for (const [name, val] of Object.entries(input.shares)) {
        const uid = resolvePerson(name, candidates, me.id);
        if (splitType === 'PERCENTAGE') shares[uid] = BigInt(Math.round(val * 100));
        else if (splitType === 'SHARE') shares[uid] = BigInt(Math.round(val));
        else if (splitType === 'EXACT' || splitType === 'ADJUSTMENT') shares[uid] = toMinorUnits(val, currency);
      }
    }

    const participants = computeSplit({ amount, paidById, participantIds, splitType, shares });

    // Build a human preview.
    const nameOf = (id: number) =>
      id === me.id ? 'you' : candidates.find((c) => c.id === id)?.name ?? `user ${id}`;
    const owedLines = participants
      .filter((p) => p.userId !== paidById)
      .map((p) => `   - ${nameOf(p.userId)} owes ${formatMoney(-p.amount, currency)}`);
    const warnings: string[] = [];
    const sum = participants.reduce((a, p) => a + p.amount, 0n);
    if (sum !== 0n) warnings.push(`⚠ participants do not balance (sum ${sum}).`);

    if (!input.confirm) {
      const key = input.idempotencyKey ?? randomUUID();
      return [
        `PREVIEW — not yet saved:`,
        `  "${input.description}" — ${formatMoney(amount, currency)} (${splitType})`,
        `  paid by ${nameOf(paidById)}${groupId ? `, in group "${input.group}"` : `, with ${input.friend}`}`,
        `  split:`,
        ...owedLines,
        ...warnings,
        ``,
        `To save it, call add_expense again with the same fields plus confirm=true and idempotency_key="${key}".`,
      ].join('\n');
    }

    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const payload = {
      paidBy: paidById,
      name: input.description,
      category: input.category ?? 'general',
      amount,
      groupId,
      splitType,
      currency,
      participants,
      expenseDate: input.date ? new Date(input.date) : undefined,
      idempotencyKey,
    };
    const result = await this.client.mutate<Array<{ id: string }>>('expense.addOrEditExpense', payload);
    const id = Array.isArray(result) ? result[0]?.id : (result as { id?: string })?.id;
    return `✅ Saved "${input.description}" ${formatMoney(amount, currency)} (${splitType}), paid by ${nameOf(paidById)}. Expense id ${id}.`;
  }

  async settleUp(input: SettleUpInput): Promise<string> {
    const me = await this.me();
    const currency = (input.currency ?? me.currency ?? 'USD').toUpperCase();
    const amount = toMinorUnits(input.amount, currency);
    if (amount <= 0n) throw new Error('Amount must be positive.');

    let candidates: Candidate[];
    let groupId: number | null = null;
    if (input.group) {
      const g = await this.resolveGroup(input.group);
      groupId = g.id;
      candidates = g.members;
    } else {
      const friends = await this.friends();
      candidates = [...friends, { id: me.id, name: me.name ?? 'me', email: me.email }];
    }

    const fromId = resolvePerson(input.from ?? 'me', candidates, me.id);
    const toId = resolvePerson(input.to, candidates, me.id);
    if (fromId === toId) throw new Error('Payer and payee must be different people.');

    const nameOf = (id: number) =>
      id === me.id ? 'you' : candidates.find((c) => c.id === id)?.name ?? `user ${id}`;

    if (!input.confirm) {
      const key = input.idempotencyKey ?? randomUUID();
      return [
        `PREVIEW — not yet saved:`,
        `  Settle up: ${nameOf(fromId)} pays ${nameOf(toId)} ${formatMoney(amount, currency)}${groupId ? ` (group "${input.group}")` : ''}`,
        ``,
        `To record it, call settle_up again with confirm=true and idempotency_key="${key}".`,
      ].join('\n');
    }

    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const payload = {
      paidBy: fromId,
      name: 'Settle up',
      category: 'general',
      amount,
      groupId,
      splitType: 'SETTLEMENT' as const,
      currency,
      participants: [
        { userId: fromId, amount },
        { userId: toId, amount: -amount },
      ],
      idempotencyKey,
    };
    const result = await this.client.mutate<Array<{ id: string }>>('expense.addOrEditExpense', payload);
    const id = Array.isArray(result) ? result[0]?.id : (result as { id?: string })?.id;
    return `✅ Recorded settle-up: ${nameOf(fromId)} → ${nameOf(toId)} ${formatMoney(amount, currency)}. Id ${id}.`;
  }

  async createGroup(name: string): Promise<string> {
    const g = await this.client.mutate<{ id: number; name: string }>('group.create', { name });
    return `✅ Created group "${g.name}" (id ${g.id}).`;
  }

  async addMember(group: string, person: string): Promise<string> {
    const me = await this.me();
    const g = await this.resolveGroup(group);
    const friends = await this.friends();
    const uid = resolvePerson(person, friends, me.id);
    await this.client.mutate('group.addMembers', { groupId: g.id, userIds: [uid] });
    const name = friends.find((f) => f.id === uid)?.name ?? `user ${uid}`;
    return `✅ Added ${name} to group "${g.name}".`;
  }
}
