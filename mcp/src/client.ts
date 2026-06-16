/**
 * Minimal tRPC-over-HTTP client for the SplitPro API.
 *
 * Speaks the batched superjson protocol the SplitPro Next.js handler expects,
 * and authenticates with a Personal Access Token (Bearer). No tRPC types are
 * imported — this is a standalone HTTP client.
 */
import superjson from 'superjson';

export class SplitProError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'SplitProError';
  }
}

function friendly(code: string, status: number | undefined, message: string): string {
  if (code === 'UNAUTHORIZED' || status === 401) {
    return 'Token invalid or expired (UNAUTHORIZED). Re-issue a Personal Access Token.';
  }
  if (code === 'FORBIDDEN' || status === 403) {
    return `Forbidden: ${message} (read-only token, or you are not a member of that group).`;
  }
  if (code === 'TOO_MANY_REQUESTS' || status === 429) {
    return 'Rate limit exceeded for this API token. Wait a minute and retry.';
  }
  return message;
}

export class SplitProClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  async query<T = unknown>(path: string, input: unknown = null): Promise<T> {
    const param = encodeURIComponent(JSON.stringify({ 0: superjson.serialize(input) }));
    const res = await fetch(`${this.baseUrl}/api/trpc/${path}?batch=1&input=${param}`, {
      headers: this.headers(),
    });
    return this.handle<T>(res, path);
  }

  async mutate<T = unknown>(path: string, input: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/trpc/${path}?batch=1`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ 0: superjson.serialize(input) }),
    });
    return this.handle<T>(res, path);
  }

  private async handle<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SplitProError(
        'PARSE_ERROR',
        `Non-JSON response from ${path} (HTTP ${res.status}): ${text.slice(0, 200)}`,
        res.status,
      );
    }

    const entry = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>) : (parsed as Record<string, unknown>);

    if (entry && 'error' in entry && entry.error) {
      const rawErr = entry.error as Record<string, unknown>;
      const errObj = (rawErr.json ?? rawErr) as Record<string, unknown>;
      const data = (errObj.data ?? {}) as Record<string, unknown>;
      const code = (data.code as string) ?? 'INTERNAL_SERVER_ERROR';
      const message = (errObj.message as string) ?? 'tRPC error';
      throw new SplitProError(code, friendly(code, res.status, message), res.status);
    }

    if (!res.ok) {
      throw new SplitProError('HTTP_ERROR', friendly('', res.status, `HTTP ${res.status} from ${path}`), res.status);
    }

    const result = (entry?.result ?? {}) as Record<string, unknown>;
    // Void mutations return no `data`; deserializing undefined would throw.
    return (result.data !== undefined ? superjson.deserialize(result.data as never) : undefined) as T;
  }
}
