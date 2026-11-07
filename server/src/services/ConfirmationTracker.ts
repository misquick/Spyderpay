import type { ChainConfig } from '../config/chains.js';
import { matchTransfer, paymentFromTransfer, type Invoice } from '../domain/invoice.js';
import type { BlockReader, TransactionInspector } from '../ports/blockchain.js';
import type { Repositories, UnitOfWork } from '../ports/repositories.js';
import type { Clock, Logger } from '../ports/system.js';
import type { WebhookPublisher } from './WebhookPublisher.js';

/**
 * Waits until a recorded payment is buried under enough blocks, re-checks it
 * (protection against chain re-organisations) and marks the invoice paid.
 */
export class ConfirmationTracker {
  constructor(
    private readonly chain: ChainConfig,
    private readonly client: TransactionInspector & BlockReader,
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly publisher: WebhookPublisher,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    const confirming = await this.repos.invoices.listByStatus(this.chain.id, 'confirming');
    if (confirming.length === 0) return;
    const head = await this.client.getHead();
    for (const invoice of confirming) await this.check(invoice, head.number);
  }

  private async check(invoice: Invoice, head: bigint): Promise<void> {
    const payment = invoice.payment!;
    const depth = depthOf(head, payment.blockNumber);
    if (depth < this.chain.confirmations) {
      if (depth !== invoice.confirmations) await this.repos.invoices.updateProgress(invoice.id, depth);
      return;
    }

    // Deep enough — make sure the transfer is still on the canonical chain.
    const tx = await this.client.inspectTransaction(payment.txHash);
    const transfer = tx.status === 'success' ? tx.transfers.find((t) => matchTransfer(invoice, t) === null) : undefined;

    if (!transfer) {
      await this.revert(invoice);
      return;
    }
    if (transfer.blockHash !== payment.blockHash) {
      // Re-included in a different block: start counting again from the new block.
      await this.repos.invoices.updateProgress(invoice.id, depthOf(head, transfer.blockNumber), paymentFromTransfer(transfer));
      return;
    }

    await this.uow.run(async (repos) => {
      const paid = await repos.invoices.transition(invoice.id, 'confirming', 'paid', {
        confirmations: depth,
        paidAt: this.clock.now(),
      });
      if (paid) await this.publisher.publish(repos, paid, 'invoice.paid');
    });
    this.logger.info('invoice paid', { invoiceId: invoice.id, txHash: payment.txHash });
  }

  /** The transaction vanished (re-org). Back to pending, and rescan from just before its block. */
  private async revert(invoice: Invoice): Promise<void> {
    const payment = invoice.payment!;
    await this.repos.invoices.transition(invoice.id, 'confirming', 'pending', { payment: null, confirmations: 0 });
    const before = payment.blockNumber > 0n ? payment.blockNumber - 1n : 0n;
    await this.repos.cursors.rewind(this.chain.id, await this.client.getBlock(before));
    this.logger.warn('payment dropped by re-org, invoice back to pending', { invoiceId: invoice.id, txHash: payment.txHash });
  }
}

const depthOf = (head: bigint, block: bigint): number => (head >= block ? Number(head - block + 1n) : 0);
