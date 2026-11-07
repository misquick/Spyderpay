import type { ChainConfig } from '../config/chains.js';
import { PaymentAlreadyUsedError } from '../domain/errors.js';
import { matchTransfer, type Invoice } from '../domain/invoice.js';
import type { BlockReader, BlockRef, TransferFinder } from '../ports/blockchain.js';
import type { Repositories, UnitOfWork } from '../ports/repositories.js';
import type { Logger } from '../ports/system.js';
import type { PaymentService } from './PaymentService.js';
import type { WebhookPublisher } from './WebhookPublisher.js';

export interface ScannerOptions {
  /** Blocks per eth_getLogs request. */
  blockRange: number;
  /** Max requests per run, so a long catch-up does not block other jobs. */
  maxBatches: number;
}

/**
 * Walks the chain block by block (with a persisted cursor), finds token transfers
 * to merchants with open invoices and matches them by exact amount.
 * Then expires invoices whose deadline is behind the scanned block time:
 * at that point we know for sure no payment arrived in time.
 */
export class PaymentScanner {
  constructor(
    private readonly chain: ChainConfig,
    private readonly client: TransferFinder & BlockReader,
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly payments: PaymentService,
    private readonly publisher: WebhookPublisher,
    private readonly logger: Logger,
    private readonly options: ScannerOptions,
  ) {}

  async run(): Promise<void> {
    const head = await this.client.getHead();
    let cursor = await this.initialCursor(head);

    for (let batch = 0; batch < this.options.maxBatches && cursor.number < head.number; batch++) {
      const pending = await this.repos.invoices.listByStatus(this.chain.id, 'pending');
      if (pending.length === 0) {
        cursor = head; // nothing to look for — jump straight to the head
        break;
      }
      const fromBlock = cursor.number + 1n;
      const toBlock = min(head.number, cursor.number + BigInt(this.options.blockRange));
      await this.matchRange(pending, fromBlock, toBlock);
      cursor = toBlock === head.number ? head : await this.client.getBlock(toBlock);
      await this.repos.cursors.save(this.chain.id, cursor);
    }
    await this.repos.cursors.save(this.chain.id, cursor);
    await this.expireBefore(cursor.time);
  }

  private async initialCursor(head: BlockRef): Promise<BlockRef> {
    const saved = await this.repos.cursors.get(this.chain.id);
    if (saved) return saved;
    // First run: look back one range so invoices created moments ago are covered.
    const start = head.number > BigInt(this.options.blockRange) ? head.number - BigInt(this.options.blockRange) : 0n;
    return this.client.getBlock(start);
  }

  private async matchRange(pending: Invoice[], fromBlock: bigint, toBlock: bigint): Promise<void> {
    const recipients = [...new Set(pending.map((i) => i.payTo))];
    const transfers = await this.client.findTransfers({
      token: this.chain.token.address,
      recipients,
      fromBlock,
      toBlock,
    });
    const open = new Set(pending);
    for (const transfer of transfers) {
      const invoice = [...open].find((i) => matchTransfer(i, transfer) === null);
      if (!invoice) continue;
      try {
        if (await this.payments.record(invoice, transfer)) {
          this.logger.info('payment detected', { invoiceId: invoice.id, txHash: transfer.txHash });
        }
        open.delete(invoice);
      } catch (error) {
        if (!(error instanceof PaymentAlreadyUsedError)) throw error;
      }
    }
  }

  private async expireBefore(asOf: Date): Promise<void> {
    for (const invoice of await this.repos.invoices.listExpired(this.chain.id, asOf)) {
      await this.uow.run(async (repos) => {
        const expired = await repos.invoices.transition(invoice.id, 'pending', 'expired');
        if (expired) await this.publisher.publish(repos, expired, 'invoice.expired');
      });
      this.logger.info('invoice expired', { invoiceId: invoice.id });
    }
  }
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
