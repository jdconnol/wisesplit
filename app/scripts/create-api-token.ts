/**
 * Issue a Personal Access Token for a user. Prints the plaintext token ONCE;
 * only its SHA-256 hash is stored.
 *
 * Usage:
 *   pnpm tsx scripts/create-api-token.ts --email you@example.com \
 *     [--scope read_write|read] [--name "MCP"] [--expires-days 90]
 */
import { db } from '~/server/db';
import { generateApiToken, hashApiToken, type TokenScope } from '~/server/apiToken';

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = getArg('--email');
  if (!email) {
    console.error('Missing required --email <address>');
    process.exit(1);
  }

  const scope: TokenScope = 'read' === getArg('--scope') ? 'read' : 'read_write';
  const name = getArg('--name') ?? 'MCP token';
  const expiresDays = getArg('--expires-days');
  const expiresAt = expiresDays
    ? new Date(Date.now() + Number(expiresDays) * 86_400_000)
    : null;

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const token = generateApiToken();
  const pat = await db.personalAccessToken.create({
    data: { name, tokenHash: hashApiToken(token), scope, userId: user.id, expiresAt },
  });

  console.log('\n✅ Personal Access Token created');
  console.log(`   user:    ${user.name ?? '(no name)'} <${user.email}> (id ${user.id})`);
  console.log(`   scope:   ${scope}`);
  console.log(`   expires: ${expiresAt ? expiresAt.toISOString() : 'never'}`);
  console.log(`   id:      ${pat.id}`);
  console.log('\n   TOKEN (shown once — copy it now):\n');
  console.log(`   ${token}\n`);

  await db.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
