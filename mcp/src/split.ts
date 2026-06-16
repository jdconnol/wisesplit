/**
 * Replicates SplitPro's expense-split math (src/store/addStore.ts) closely enough
 * to produce participant rows the server accepts.
 *
 * Convention (matches SplitPro): each participant row carries a SIGNED amount —
 * the payer is positive (the total they are owed by everyone else), each debtor is
 * negative (what they owe). All rows sum to exactly 0.
 *
 * The only intentional deviation from the app is WHICH participant absorbs an odd
 * rounding penny: SplitPro uses a seeded shuffle; we distribute deterministically
 * to the lowest user ids. This never affects balance correctness (sum is still 0,
 * magnitudes still total the expense amount).
 */

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARE' | 'ADJUSTMENT';

export interface Participant {
  userId: number;
  amount: bigint;
}

export interface SplitInput {
  /** Total expense amount, positive, in minor units. */
  amount: bigint;
  paidById: number;
  /** Every user involved, including the payer. */
  participantIds: number[];
  splitType: SplitType;
  /**
   * Per-user share, already in the unit each split type expects:
   *  - PERCENTAGE: basis points (2500 = 25%)
   *  - SHARE:      integer weight
   *  - EXACT:      minor units owed
   *  - ADJUSTMENT: minor-unit adjustment on top of the equal base
   *  - EQUAL:      ignored
   */
  shares?: Record<number, bigint>;
}

function distributeRemainder(gross: Record<number, bigint>, ids: number[], amount: bigint) {
  const sum = ids.reduce((a, id) => a + (gross[id] ?? 0n), 0n);
  let rem = amount - sum;
  const sorted = [...ids].sort((a, b) => a - b);
  let i = 0;
  while (rem !== 0n && sorted.length > 0) {
    const id = sorted[i % sorted.length]!;
    const step = rem > 0n ? 1n : -1n;
    gross[id] = (gross[id] ?? 0n) + step;
    rem -= step;
    i++;
  }
}

export function computeSplit(input: SplitInput): Participant[] {
  const { amount, paidById, participantIds, splitType, shares = {} } = input;
  const ids = [...new Set(participantIds)];
  if (ids.length === 0) {
    throw new Error('At least one participant is required');
  }
  if (amount <= 0n) {
    throw new Error('Amount must be positive');
  }

  const gross: Record<number, bigint> = {};

  switch (splitType) {
    case 'EQUAL': {
      const base = amount / BigInt(ids.length);
      for (const id of ids) gross[id] = base;
      distributeRemainder(gross, ids, amount);
      break;
    }
    case 'PERCENTAGE': {
      for (const id of ids) gross[id] = (amount * (shares[id] ?? 0n)) / 10_000n;
      distributeRemainder(gross, ids, amount);
      break;
    }
    case 'SHARE': {
      const total = ids.reduce((a, id) => a + (shares[id] ?? 0n), 0n);
      if (total <= 0n) throw new Error('Total shares must be greater than 0');
      for (const id of ids) gross[id] = (amount * (shares[id] ?? 0n)) / total;
      distributeRemainder(gross, ids, amount);
      break;
    }
    case 'EXACT': {
      for (const id of ids) gross[id] = shares[id] ?? 0n;
      const total = ids.reduce((a, id) => a + gross[id]!, 0n);
      if (total !== amount) {
        throw new Error(
          `Exact amounts sum to ${total} but the expense total is ${amount} (minor units)`,
        );
      }
      break;
    }
    case 'ADJUSTMENT': {
      const totalAdj = ids.reduce((a, id) => a + (shares[id] ?? 0n), 0n);
      const base = (amount - totalAdj) / BigInt(ids.length);
      for (const id of ids) gross[id] = base + (shares[id] ?? 0n);
      distributeRemainder(gross, ids, amount);
      break;
    }
  }

  // Transform gross (positive owed) into SplitPro's signed convention.
  return ids.map((id) => ({
    userId: id,
    amount: id === paidById ? amount - gross[id]! : -gross[id]!,
  }));
}
