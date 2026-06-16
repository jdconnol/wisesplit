/**
 * End-to-end QA harness for the SplitPro MCP API layer. Runs against a live
 * SplitPro instance using SPLITPRO_URL / SPLITPRO_TOKEN.
 *
 *   SPLITPRO_TOKEN=spat_... pnpm tsx test/run.ts
 */
import { SplitProApi } from '../src/api.js';

const url = process.env.SPLITPRO_URL ?? 'http://localhost:3000';
const token = process.env.SPLITPRO_TOKEN;
if (!token) {
  console.error('SPLITPRO_TOKEN required');
  process.exit(1);
}
const api = new SplitProApi(url, token);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}
function section(t: string) {
  console.log(`\n=== ${t} ===`);
}
const idOf = (s: string) => s.match(/id ([0-9a-f-]{36})/i)?.[1];

async function main() {
  section('reads');
  const me = await api.me();
  console.log(`  me: ${me.name} <${me.email}> id=${me.id} ${me.currency ?? ''}`);
  check('me() returns id', typeof me.id === 'number');

  console.log(await api.listGroups());
  console.log(await api.getBalances());
  console.log(await api.listExpenses({ limit: 4 }));
  console.log(await api.searchExpenses({ query: 'e', limit: 3 }));

  const friends = await api.friends();
  console.log(`  ${friends.length} friend(s)`);
  check('has at least one friend to test with', friends.length > 0);
  if (friends.length === 0) return;
  const f = friends[0]!;
  const fname = f.name ?? f.email ?? String(f.id);
  console.log(`  using friend: ${fname} (id ${f.id})`);

  section('add_expense PREVIEW (no write)');
  const preview = await api.addExpense({
    description: 'MCP QA dinner',
    amount: 12.34,
    friend: fname,
    splitType: 'EQUAL',
    confirm: false,
  });
  console.log(preview);
  check('preview mentions not saved', /PREVIEW/.test(preview));
  const key = preview.match(/idempotency_key="([^"]+)"/)?.[1];
  check('preview returns an idempotency_key', Boolean(key));

  section('add_expense CONFIRM');
  const save1 = await api.addExpense({
    description: 'MCP QA dinner',
    amount: 12.34,
    friend: fname,
    splitType: 'EQUAL',
    confirm: true,
    idempotencyKey: key,
  });
  console.log(`  ${save1}`);
  const id1 = idOf(save1);
  check('first confirm saved an expense', Boolean(id1) && /Saved/.test(save1));

  section('add_expense IDEMPOTENT retry (same key)');
  const save2 = await api.addExpense({
    description: 'MCP QA dinner',
    amount: 12.34,
    friend: fname,
    splitType: 'EQUAL',
    confirm: true,
    idempotencyKey: key,
  });
  console.log(`  ${save2}`);
  const id2 = idOf(save2);
  check('retry returns the SAME expense id (no duplicate)', Boolean(id1) && id1 === id2, `(${id1} vs ${id2})`);

  section('settle_up preview + confirm');
  const sPrev = await api.settleUp({ to: fname, amount: 5, confirm: false });
  console.log(sPrev);
  const sKey = sPrev.match(/idempotency_key="([^"]+)"/)?.[1];
  const sDone = await api.settleUp({ to: fname, amount: 5, confirm: true, idempotencyKey: sKey });
  console.log(`  ${sDone}`);
  check('settle-up recorded', /Recorded settle-up/.test(sDone));

  section('split-type math via EXACT (must balance)');
  const exactPrev = await api.addExpense({
    description: 'MCP QA exact',
    amount: 10.0,
    friend: fname,
    splitType: 'EXACT',
    shares: { me: 6.0, [fname]: 4.0 },
    confirm: false,
  });
  console.log(exactPrev);
  check('exact split previews without imbalance warning', !/do not balance/.test(exactPrev));

  section('create_group + add_member');
  const gname = `MCP QA Group ${me.id}-${id1?.slice(0, 4) ?? 'x'}`;
  const gMsg = await api.createGroup(gname);
  console.log(`  ${gMsg}`);
  check('group created', /Created group/.test(gMsg));
  try {
    const amMsg = await api.addMember(gname, fname);
    console.log(`  ${amMsg}`);
    check('member added', /Added/.test(amMsg));
  } catch (e) {
    check('member added', false, String(e));
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
