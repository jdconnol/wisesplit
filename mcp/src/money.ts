/** Currency minor-unit helpers (SplitPro stores amounts as BigInt minor units). */

const ZERO_DECIMAL = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF', 'RWF', 'GNF',
  'BIF', 'DJF', 'KMF', 'PYG', 'VUV',
]);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'TND', 'IQD', 'JOD', 'LYD']);

export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** Convert a human amount (e.g. 63.40) to BigInt minor units (6340n for USD). */
export function toMinorUnits(amount: number, currency: string): bigint {
  const d = currencyDecimals(currency);
  return BigInt(Math.round(amount * 10 ** d));
}

/** Convert BigInt minor units back to a decimal string (e.g. "63.40"). */
export function fromMinorUnits(amount: bigint, currency: string): string {
  const d = currencyDecimals(currency);
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const s = abs.toString().padStart(d + 1, '0');
  const whole = s.slice(0, s.length - d) || '0';
  const frac = d > 0 ? '.' + s.slice(s.length - d) : '';
  return (neg ? '-' : '') + whole + frac;
}

export function formatMoney(amount: bigint, currency: string): string {
  return `${fromMinorUnits(amount, currency)} ${currency.toUpperCase()}`;
}
