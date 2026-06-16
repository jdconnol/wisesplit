/**
 * Real MCP protocol round-trip: spawn the stdio server as a subprocess, connect
 * an MCP client to it, list tools, and call a read + a write (preview) tool.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/index.ts'],
  env: {
    PATH: process.env.PATH ?? '',
    SPLITPRO_URL: process.env.SPLITPRO_URL ?? 'http://localhost:3000',
    SPLITPRO_TOKEN: process.env.SPLITPRO_TOKEN ?? '',
  },
});

const client = new Client({ name: 'qa-client', version: '1.0.0' });

async function main() {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`tools (${names.length}): ${names.join(', ')}`);
  const expected = [
    'add_expense', 'add_member', 'create_group', 'get_balances',
    'list_expenses', 'list_groups', 'search_expenses', 'settle_up',
  ];
  const ok = expected.every((e) => names.includes(e)) && names.length === expected.length;
  console.log(ok ? '✓ all 8 tools registered' : `✗ tool mismatch (expected ${expected.length})`);

  const groups = await client.callTool({ name: 'list_groups', arguments: {} });
  const gtext = (groups.content as Array<{ text: string }>)[0]?.text ?? '';
  console.log(`list_groups -> ${gtext.split('\n')[0]}`);

  const preview = await client.callTool({
    name: 'add_expense',
    arguments: { description: 'stdio smoke', amount: 9.99, friend: 'Nathen', confirm: false },
  });
  const ptext = (preview.content as Array<{ text: string }>)[0]?.text ?? '';
  console.log(`add_expense preview -> ${ptext.split('\n')[0]} ${/PREVIEW/.test(ptext) ? '✓' : '✗'}`);

  await client.close();
  console.log(ok ? '\nSTDIO OK' : '\nSTDIO FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('stdio test error', e);
  process.exit(1);
});
