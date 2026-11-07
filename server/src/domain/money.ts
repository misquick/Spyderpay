import { randomInt } from 'node:crypto';
import { formatUnits, parseUnits } from 'viem';
import { AppError } from './errors.js';

/** Amount a merchant can request: up to 9 integer digits and 2 decimals ("10", "10.5", "10.50"). */
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/;

/** How many distinct tails exist for one base amount (0.000001 … 0.009999). */
export const TAIL_VARIANTS = 9999;

export function toUnits(amount: string, decimals: number): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive number with at most 2 decimals');
  }
  const units = parseUnits(amount, decimals);
  if (units < parseUnits('0.01', decimals)) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Minimum amount is 0.01');
  }
  return units;
}

export const fromUnits = (units: bigint, decimals: number): string => formatUnits(units, decimals);

/** "10" → "10.00", "10.5" → "10.50" (expects a value that passed AMOUNT_PATTERN). */
export function normalizeAmount(amount: string): string {
  const [integer, fraction = ''] = amount.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/**
 * Adds a tiny unique tail (between 0.000001 and 0.009999 of the token) to the amount.
 *
 * Every open invoice that pays to the same address gets a different exact on-chain
 * amount, so an incoming transfer can be matched to exactly one invoice — without
 * generating deposit addresses or ever holding customers' private keys.
 */
export function withUniqueTail(
  base: bigint,
  decimals: number,
  pickTail: () => number = () => randomInt(1, TAIL_VARIANTS + 1),
): bigint {
  if (decimals < 6) throw new Error('Token must have at least 6 decimals');
  const tail = pickTail();
  if (!Number.isInteger(tail) || tail < 1 || tail > TAIL_VARIANTS) throw new Error('Tail out of range');
  const step = 10n ** BigInt(decimals - 6);
  return base + BigInt(tail) * step;
}
