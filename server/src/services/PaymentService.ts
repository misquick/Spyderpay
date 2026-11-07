import { AppError, notFound } from '../domain/errors.js';
import { matchTransfer, paymentFromTransfer, type Invoice } from '../domain/invoice.js';
import type { TokenTransfer } from '../domain/transfer.js';
import type { ChainClients } from '../ports/blockchain.js';
import type { InvoiceRepository } from '../ports/repositories.js';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Links an on-chain transfer to an invoice (pending → confirming).
 * Used by both detection paths: the customer's browser reporting a tx hash,
 * and the background scanner finding the transfer by itself.
 */
export class PaymentService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly chainClients: ChainClients,
  ) {}

  /** Fast path: the payment page reports the hash right after the wallet sends it. */
  async submitTransaction(invoiceId: string, txHash: string): Promise<Invoice> {
    if (!TX_HASH.test(txHash)) throw new AppError(400, 'INVALID_TX_HASH', 'Transaction hash is malformed');
    const hash = txHash.toLowerCase();

    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) throw notFound('Invoice');
    if (invoice.payment?.txHash === hash) return invoice; // already recorded — idempotent
    if (invoice.status !== 'pending') {
      throw new AppError(409, 'INVOICE_NOT_PAYABLE', `Invoice is ${invoice.status}`);
    }

    const tx = await this.chainClients.forChain(invoice.chainId).inspectTransaction(hash);
    if (tx.status === 'not_found') {
      throw new AppError(409, 'TX_NOT_FOUND', 'Transaction is not mined yet, retry in a few seconds');
    }
    if (tx.status === 'reverted') throw new AppError(422, 'TX_REVERTED', 'Transaction failed on chain');

    const transfer = tx.transfers.find((t) => matchTransfer(invoice, t) === null);
    if (!transfer) {
      const reasons = [...new Set(tx.transfers.map((t) => matchTransfer(invoice, t)))];
      throw new AppError(422, 'NO_MATCHING_TRANSFER', 'Transaction does not pay this invoice', { reasons });
    }
    return (await this.record(invoice, transfer)) ?? (await this.invoices.findById(invoiceId))!;
  }

  /** Returns `null` if the invoice was no longer pending (another path got there first). */
  record(invoice: Invoice, transfer: TokenTransfer): Promise<Invoice | null> {
    return this.invoices.transition(invoice.id, 'pending', 'confirming', {
      payment: paymentFromTransfer(transfer),
      confirmations: 1, // the block that contains it
    });
  }
}
