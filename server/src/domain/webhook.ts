import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_EVENTS = ['invoice.paid', 'invoice.expired'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const MAX_WEBHOOK_ATTEMPTS = 10;

export interface WebhookDelivery {
  id: string;
  merchantId: string;
  invoiceId: string;
  event: WebhookEvent;
  url: string;
  payload: unknown;
  /** Attempts made so far, including the one currently in progress. */
  attempts: number;
}

export type NewWebhookDelivery = Omit<WebhookDelivery, 'attempts'>;

/** Exponential back-off: 30 s, 1 min, 2 min … capped at 6 hours. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempt - 1, 0), 6 * 60 * 60 * 1000);
}

/** HMAC-SHA256 over `${timestamp}.${body}` — the same scheme Stripe uses. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${signWebhook(secret, timestamp, body)}`;
}

/** Reference implementation of the check a merchant performs on their side. */
export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const timestamp = Number(parts.t);
  const received = parts.v1;
  if (!Number.isFinite(timestamp) || !received) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body), 'hex');
  const actual = Buffer.from(received, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
