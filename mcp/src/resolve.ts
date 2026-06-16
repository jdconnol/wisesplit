/** Fuzzy person resolution: a name/email/id fragment -> a single user id, or an error on ambiguity. */

export interface Candidate {
  id: number;
  name: string | null;
  email: string | null;
}

const SELF_WORDS = new Set(['me', 'myself', 'i', 'self']);

export function resolvePerson(query: string, candidates: Candidate[], meId: number): number {
  const q = query.trim().toLowerCase();
  if (SELF_WORDS.has(q)) {
    return meId;
  }
  if (/^\d+$/.test(q)) {
    const byId = candidates.find((c) => c.id === Number(q));
    if (byId) return byId.id;
  }

  const exact = candidates.filter(
    (c) => c.name?.toLowerCase() === q || c.email?.toLowerCase() === q,
  );
  if (exact.length === 1) return exact[0]!.id;

  const partial = candidates.filter(
    (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
  );
  if (partial.length === 1) return partial[0]!.id;
  if (partial.length === 0) {
    throw new Error(`No person matching "${query}".`);
  }
  const names = partial.map((c) => `${c.name ?? c.email} (id ${c.id})`).join(', ');
  throw new Error(`"${query}" is ambiguous — matches: ${names}. Be more specific or use the numeric id.`);
}
