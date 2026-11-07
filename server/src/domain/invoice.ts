import { AppError } from './errors.js';
import type { TokenTransfer } from './transfer.js';

export const INVOICE_STATUSES = ['pending', 'confirming', 'paid', 'expired', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * The invoice state machine. Anything not listed here is an illegal move.
 *
 *   pending ──payment seen──▶ confirming ──enough confirmations──▶ paid
 *      │  ▲                       │
 *      │  └──── block re-org ─────┘
 *      ├──time is up──▶ expired
 *      └──merchant────▶ cancelled
 */
const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  pending: ['confirming', 'expired', 'cancelled'],
  confirming: ['paid', 'pending'],
  paid: [],
  expired: [],
  cancelled: [],
};

export const canTransition = (from: InvoiceStatus, to: InvoiceStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_STATE', `Invoice cannot move from "${from}" to "${to}"`);
  }
}

export const isFinal = (status: InvoiceStatus): boolean => TRANSITIONS[status].length === 0;

export interface PaymentRef {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  payer: string;
}

export interface InvoiceToken {
  /** Lower-case contract address. */
  address: string;
  symbol: string;
  decimals: number;
}

export interface Invoice {
  id: string;
  merchantId: string;
  status: InvoiceStatus;
  chainId: number;
  token: InvoiceToken;
  /** Lower-case address the customer must pay to (merchant payout address at creation time). */
  payTo: string;
  /** Amount the merchant asked for, e.g. "10.00". */
  amount: string;
  /** Exact amount the customer pays, in token base units (amount + unique tail). */
  amountUnits: bigint;
  description: string | null;
  orderId: string | null;
  redirectUrl: string | null;
  payment: PaymentRef | null;
  confirmations: number;
  createdAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
  updatedAt: Date;
}

export type NewInvoice = Pick<
  Invoice,
  | 'id'
  | 'merchantId'
  | 'chainId'
  | 'token'
  | 'payTo'
  | 'amount'
  | 'amountUnits'
  | 'description'
  | 'orderId'
  | 'redirectUrl'
  | 'createdAt'
  | 'expiresAt'
>;

/** How far a block timestamp may precede invoice creation (node clocks drift a little). */
export const CLOCK_SKEW_MS = 60_000;

export type MatchFailure = 'wrong_chain' | 'wrong_token' | 'wrong_recipient' | 'wrong_amount' | 'outside_window';

/** Returns `null` when the transfer pays this invoice, otherwise the reason it does not. */
export function matchTransfer(invoice: Invoice, transfer: TokenTransfer): MatchFailure | null {
  if (transfer.chainId !== invoice.chainId) return 'wrong_chain';
  if (transfer.token !== invoice.token.address) return 'wrong_token';
  if (transfer.to !== invoice.payTo) return 'wrong_recipient';
  if (transfer.value !== invoice.amountUnits) return 'wrong_amount';
  const time = transfer.blockTime.getTime();
  if (time < invoice.createdAt.getTime() - CLOCK_SKEW_MS || time > invoice.expiresAt.getTime()) {
    return 'outside_window';
  }
  return null;
}

export const paymentFromTransfer = (t: TokenTransfer): PaymentRef => ({
  txHash: t.txHash,
  logIndex: t.logIndex,
  blockNumber: t.blockNumber,
  blockHash: t.blockHash,
  payer: t.from,
});
