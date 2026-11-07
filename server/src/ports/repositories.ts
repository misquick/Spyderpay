import type { Invoice, InvoiceStatus, NewInvoice, PaymentRef } from '../domain/invoice.js';
import type { Merchant, MerchantPatch, NewMerchant } from '../domain/merchant.js';
import type { NewWebhookDelivery, WebhookDelivery } from '../domain/webhook.js';
import type { BlockRef } from './blockchain.js';

/**
 * Storage contracts. Services depend on these interfaces, never on PostgreSQL
 * directly (Dependency Inversion) — which is why unit tests can run on in-memory fakes.
 */

export interface MerchantRepository {
  create(merchant: NewMerchant): Promise<Merchant>;
  findById(id: string): Promise<Merchant | null>;
  findByApiKeyHash(hash: string): Promise<Merchant | null>;
  update(id: string, patch: MerchantPatch): Promise<Merchant>;
}

export interface TransitionChanges {
  payment?: PaymentRef | null;
  confirmations?: number;
  paidAt?: Date | null;
}

export interface InvoiceRepository {
  /** @throws DuplicateAmountError if another open invoice already expects the same exact amount. */
  insert(invoice: NewInvoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  listByMerchant(merchantId: string, limit: number): Promise<Invoice[]>;
  listByStatus(chainId: number, status: InvoiceStatus): Promise<Invoice[]>;
  /** Pending invoices whose deadline is earlier than `asOf`. */
  listExpired(chainId: number, asOf: Date): Promise<Invoice[]>;
  /**
   * Compare-and-set status change: applies only if the invoice is still in `from`.
   * Returns the updated invoice, or `null` if someone else changed it first.
   * @throws PaymentAlreadyUsedError if `changes.payment` is already linked to another invoice.
   */
  transition(id: string, from: InvoiceStatus, to: InvoiceStatus, changes?: TransitionChanges): Promise<Invoice | null>;
  /** Updates confirmation progress (and the payment's block after a re-org). */
  updateProgress(id: string, confirmations: number, payment?: PaymentRef): Promise<void>;
}

export interface WebhookRepository {
  enqueue(delivery: NewWebhookDelivery): Promise<void>;
  /** Leases due deliveries so parallel workers never send the same one twice. */
  claimDue(now: Date, limit: number): Promise<WebhookDelivery[]>;
  markDelivered(id: string, at: Date): Promise<void>;
  /** `retryAt = null` gives up on the delivery for good. */
  markFailed(id: string, error: string, retryAt: Date | null): Promise<void>;
}

export interface CursorRepository {
  get(chainId: number): Promise<BlockRef | null>;
  save(chainId: number, block: BlockRef): Promise<void>;
  /** Moves the cursor back to `block`, but only if it is currently ahead of it. */
  rewind(chainId: number, block: BlockRef): Promise<void>;
}

export interface Repositories {
  merchants: MerchantRepository;
  invoices: InvoiceRepository;
  webhooks: WebhookRepository;
  cursors: CursorRepository;
}

/** Runs several repository calls atomically (one database transaction). */
export interface UnitOfWork {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
