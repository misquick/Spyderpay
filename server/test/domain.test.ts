import { describe, expect, it } from 'vitest';
import { canTransition, matchTransfer, type Invoice } from '../src/domain/invoice.js';
import { normalizeAmount, toUnits, withUniqueTail } from '../src/domain/money.js';
import { retryDelayMs, signatureHeader, verifyWebhook } from '../src/domain/webhook.js';
import { CUSTOMER_WALLET, MERCHANT_WALLET, TOKEN } from './fakes.js';

describe('money', () => {
  it('converts merchant amounts to token units', () => {
    expect(toUnits('10', 6)).toBe(10_000_000n);
    expect(toUnits('0.01', 6)).toBe(10_000n);
    expect(toUnits('12.5', 18)).toBe(12_500_000_000_000_000_000n);
  });

  it('rejects malformed, too precise or too small amounts', () => {
    for (const bad of ['', 'abc', '-1', '1.234', '01', '0', '0.00', '1e5']) {
      expect(() => toUnits(bad, 6), bad).toThrow();
    }
  });

  it('normalizes to two decimals', () => {
    expect(normalizeAmount('10')).toBe('10.00');
    expect(normalizeAmount('10.5')).toBe('10.50');
    expect(normalizeAmount('10.25')).toBe('10.25');
  });

  it('adds a tail below one cent', () => {
    expect(withUniqueTail(10_000_000n, 6, () => 1)).toBe(10_000_001n);
    expect(withUniqueTail(10_000_000n, 6, () => 9999)).toBe(10_009_999n);
    expect(withUniqueTail(10n ** 19n, 18, () => 42)).toBe(10n ** 19n + 42n * 10n ** 12n);
    expect(() => withUniqueTail(1n, 6, () => 0)).toThrow();
  });
});

describe('invoice state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending', 'confirming')).toBe(true);
    expect(canTransition('confirming', 'paid')).toBe(true);
    expect(canTransition('confirming', 'pending')).toBe(true); // re-org
    expect(canTransition('pending', 'paid')).toBe(false); // must be confirmed first
    expect(canTransition('paid', 'cancelled')).toBe(false);
    expect(canTransition('expired', 'pending')).toBe(false);
    expect(canTransition('confirming', 'cancelled')).toBe(false);
  });
});

describe('matchTransfer', () => {
  const created = new Date('2026-01-01T12:00:00Z');
  const invoice = {
    chainId: 84532,
    token: { address: TOKEN, symbol: 'USDC', decimals: 6 },
    payTo: MERCHANT_WALLET,
    amountUnits: 10_000_437n,
    createdAt: created,
    expiresAt: new Date(created.getTime() + 30 * 60_000),
  } as Invoice;
  const transfer = {
    chainId: 84532,
    txHash: '0xabc',
    logIndex: 0,
    blockNumber: 1n,
    blockHash: '0xdef',
    blockTime: new Date(created.getTime() + 60_000),
    token: TOKEN,
    from: CUSTOMER_WALLET,
    to: MERCHANT_WALLET,
    value: 10_000_437n,
  };

  it('accepts the exact payment', () => expect(matchTransfer(invoice, transfer)).toBeNull());
  it('rejects another token', () => expect(matchTransfer(invoice, { ...transfer, token: '0x01' })).toBe('wrong_token'));
  it('rejects another recipient', () => expect(matchTransfer(invoice, { ...transfer, to: CUSTOMER_WALLET })).toBe('wrong_recipient'));
  it('rejects a different amount, even 1 unit off', () =>
    expect(matchTransfer(invoice, { ...transfer, value: 10_000_436n })).toBe('wrong_amount'));
  it('rejects transfers made before the invoice existed', () =>
    expect(matchTransfer(invoice, { ...transfer, blockTime: new Date(created.getTime() - 5 * 60_000) })).toBe('outside_window'));
  it('rejects transfers after expiry', () =>
    expect(matchTransfer(invoice, { ...transfer, blockTime: new Date(created.getTime() + 31 * 60_000) })).toBe('outside_window'));
});

describe('webhook signature', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ type: 'invoice.paid' });
  const now = 1_800_000_000;

  it('round-trips', () => {
    expect(verifyWebhook(secret, signatureHeader(secret, now, body), body, now)).toBe(true);
  });
  it('fails for a tampered body or a wrong secret', () => {
    const header = signatureHeader(secret, now, body);
    expect(verifyWebhook(secret, header, body + ' ', now)).toBe(false);
    expect(verifyWebhook('whsec_other', header, body, now)).toBe(false);
  });
  it('fails for replayed old messages', () => {
    expect(verifyWebhook(secret, signatureHeader(secret, now - 600, body), body, now)).toBe(false);
  });
  it('backs off exponentially with a cap', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(50)).toBe(6 * 60 * 60 * 1000);
  });
});
