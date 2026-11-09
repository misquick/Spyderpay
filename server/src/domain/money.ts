import { randomInt } from 'node:crypto';
import { formatUnits, parseUnits } from 'viem';
import { AppError } from './errors.js';

/** Shape of an amount a merchant can type: up to 9 integer digits and a fraction ("10", "0.0015"). */
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,8})(\.\d{1,18})?$/;

/** How many distinct tails exist for one base amount (0.000001 … 0.009999). */
export const TAIL_VARIANTS = 9999;

/**
 * Converts a merchant amount to base units. `precision` = how many decimals the
 * merchant may use (2 for USDC, 6 for ETH); the digits after that hold the unique tail.
 */
export function toUnits(amount: string, decimals: number, precision = 2): bigint {
  const fraction = amount.split('.')[1] ?? '';
  if (!AMOUNT_PATTERN.test(amount) || fraction.length > precision) {
    throw new AppError(400, 'INVALID_AMOUNT', `Amount must be a positive number with at most ${precision} decimals`);
  }
  const units = parseUnits(amount, decimals);
  const minimum = `0.${'0'.repeat(precision - 1)}1`;
  if (units < parseUnits(minimum, decimals)) {
    throw new AppError(400, 'INVALID_AMOUNT', `Minimum amount is ${minimum}`);
  }
  return units;
}

export const fromUnits = (units: bigint, decimals: number): string => formatUnits(units, decimals);

/** "10" → "10.00", "10.5" → "10.50" with precision 2 (expects a value that passed toUnits). */
export function normalizeAmount(amount: string, precision = 2): string {
  const [integer, fraction = ''] = amount.split('.');
  return `${integer}.${fraction.padEnd(precision, '0')}`;
}

/**
 * Adds a tiny unique tail: 4 digits right after the merchant's precision
 * (USDC, precision 2: 0.000001–0.009999; ETH, precision 6: 0.0000000001–0.0000009999).
 *
 * Every open invoice that pays to the same address gets a different exact on-chain
 * amount, so an incoming transfer can be matched to exactly one invoice — without
 * generating deposit addresses or ever holding customers' private keys.
 */
export function withUniqueTail(
  base: bigint,
  decimals: number,
  pickTail: () => number = () => randomInt(1, TAIL_VARIANTS + 1),
  precision = 2,
): bigint {
  if (decimals < precision + 4) throw new Error('Token needs at least 4 decimals beyond the amount precision');
  const tail = pickTail();
  if (!Number.isInteger(tail) || tail < 1 || tail > TAIL_VARIANTS) throw new Error('Tail out of range');
  const step = 10n ** BigInt(decimals - precision - 4);
  return base + BigInt(tail) * step;
}
