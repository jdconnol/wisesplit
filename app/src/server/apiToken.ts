/**
 * Personal Access Token (PAT) support for programmatic / agent (MCP) access.
 *
 * The plaintext token is shown ONCE at creation and never stored; only its
 * SHA-256 hash lives in the database. A Bearer token resolves to the same
 * `next-auth` Session shape that cookie auth produces, so every existing
 * `protectedProcedure` works unchanged.
 */
import { createHash, randomBytes } from 'crypto';
import { type Session } from 'next-auth';

import { db } from '~/server/db';

export const TOKEN_PREFIX = 'spat_';

export type TokenScope = 'read' | 'read_write';

/** Generate a new plaintext token. Shown once; only its hash is persisted. */
export function generateApiToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a plaintext token, used as the DB lookup key. */
export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// --- simple in-memory rate limiter: 60 requests / 60s per token ---
const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    // Opportunistically prune expired buckets so the map can't grow unbounded.
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (now > b.resetAt) {
          buckets.delete(k);
        }
      }
    }
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export type BearerAuth = { session: Session; scope: TokenScope };

/**
 * Resolve an `Authorization: Bearer <token>` header to a Session + scope.
 * Returns:
 *  - null            when there is no/foreign bearer token (fall through to cookie auth)
 *  - 'RATE_LIMITED'  when the token exceeded its request budget
 *  - BearerAuth      on success
 */
export async function resolveBearerAuth(
  authHeader: string | undefined,
): Promise<BearerAuth | 'RATE_LIMITED' | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const raw = authHeader.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const tokenHash = hashApiToken(raw);
  if (!withinRateLimit(tokenHash)) {
    return 'RATE_LIMITED';
  }

  const pat = await db.personalAccessToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!pat) {
    return null;
  }
  if (pat.expiresAt && pat.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // fire-and-forget; never block the request on the bookkeeping write
  void db.personalAccessToken
    .update({ where: { id: pat.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  const u = pat.user;
  const session: Session = {
    expires: pat.expiresAt?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: u.id,
      name: u.name ?? '',
      email: u.email ?? '',
      image: u.image ?? '',
      currency: u.currency,
      defaultCurrency: u.defaultCurrency,
      obapiProviderId: u.obapiProviderId ?? undefined,
      bankingId: u.bankingId ?? undefined,
      preferredLanguage: u.preferredLanguage,
      hiddenFriendIds: u.hiddenFriendIds,
    },
  };

  return { session, scope: 'read' === pat.scope ? 'read' : 'read_write' };
}
