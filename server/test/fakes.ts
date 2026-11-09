import { ChainRegistry, type ChainConfig } from '../src/config/chains.js';
import { DuplicateAmountError, notFound, PaymentAlreadyUsedError } from '../src/domain/errors.js';
import type { Invoice, InvoiceStatus, NewInvoice, PaymentRef } from '../src/domain/invoice.js';
import type { Merchant, MerchantPatch, NewMerchant } from '../src/domain/merchant.js';
import type { TokenTransfer } from '../src/domain/transfer.js';
import type { NewWebhookDelivery, WebhookDelivery } from '../src/domain/webhook.js';
import type { BlockRef, ChainClient, ChainClients, TransferQuery, TxInspection } from '../src/ports/blockchain.js';
import type {
  CursorRepository,
  InvoiceRepository,
  MerchantRepository,
  Repositories,
  TransitionChanges,
  UnitOfWork,
  WebhookRepository,
} from '../src/ports/repositories.js';
import type { Clock, WebhookRequest, WebhookResult, WebhookSender } from '../src/ports/system.js';
import { baseSepolia } from 'viem/chains';

/**
 * In-memory implementations of the ports. Because services depend on interfaces
 * (Dependency Inversion), the whole payment flow can be tested without a database
 * or a blockchain node.
 */

export const TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
export const MERCHANT_WALLET = '0x1111111111111111111111111111111111111111';
export const CUSTOMER_WALLET = '0x2222222222222222222222222222222222222222';

export const testChain: ChainConfig = {
  id: baseSepolia.id,
  name: 'Base Sepolia',
  testnet: true,
  token: { address: TOKEN, symbol: 'USDC', decimals: 6, precision: 2 },
  confirmations: 3,
  rpcUrl: undefined,
  publicRpcUrl: 'https://sepolia.base.org',
  explorerUrl: 'https://sepolia.basescan.org',
  faucetUrl: null,
  viem: baseSepolia,
};

export const testChains = new ChainRegistry([testChain]);

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-01-01T12:00:00Z')) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class MemoryMerchants implements MerchantRepository {
  readonly rows = new Map<string, Merchant & { apiKeyHash: string }>();
  async create(m: NewMerchant) {
    const row = { ...m, createdAt: new Date() };
    this.rows.set(m.id, row);
    return strip(row);
  }
  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? strip(row) : null;
  }
  async findByApiKeyHash(hash: string) {
    const row = [...this.rows.values()].find((r) => r.apiKeyHash === hash);
    return row ? strip(row) : null;
  }
  async update(id: string, patch: MerchantPatch) {
    const row = this.rows.get(id);
    if (!row) throw notFound('Merchant');
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return strip(row);
  }
}
const strip = ({ apiKeyHash: _h, ...m }: Merchant & { apiKeyHash: string }): Merchant => ({ ...m });

const OPEN: InvoiceStatus[] = ['pending', 'confirming'];

class MemoryInvoices implements InvoiceRepository {
  readonly rows = new Map<string, Invoice>();
  async insert(i: NewInvoice) {
    const clash = [...this.rows.values()].some(
      (r) => OPEN.includes(r.status) && r.chainId === i.chainId && r.payTo === i.payTo && r.amountUnits === i.amountUnits,
    );
    if (clash) throw new DuplicateAmountError();
    const invoice: Invoice = { ...i, status: 'pending', payment: null, confirmations: 0, paidAt: null, updatedAt: i.createdAt };
    this.rows.set(i.id, invoice);
    return { ...invoice };
  }
  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  async listByMerchant(merchantId: string, limit: number) {
    return [...this.rows.values()].filter((r) => r.merchantId === merchantId).slice(0, limit);
  }
  async listByStatus(chainId: number, status: InvoiceStatus) {
    return [...this.rows.values()].filter((r) => r.chainId === chainId && r.status === status).map((r) => ({ ...r }));
  }
  async listExpired(chainId: number, asOf: Date) {
    return [...this.rows.values()].filter((r) => r.chainId === chainId && r.status === 'pending' && r.expiresAt < asOf);
  }
  async transition(id: string, from: InvoiceStatus, to: InvoiceStatus, changes: TransitionChanges = {}) {
    const row = this.rows.get(id);
    if (!row || row.status !== from) return null;
    const p = changes.payment;
    if (p) {
      const used = [...this.rows.values()].some(
        (r) => r.id !== id && r.payment?.txHash === p.txHash && r.payment.logIndex === p.logIndex,
      );
      if (used) throw new PaymentAlreadyUsedError();
    }
    row.status = to;
    if (changes.payment !== undefined) row.payment = changes.payment;
    if (changes.confirmations !== undefined) row.confirmations = changes.confirmations;
    if (changes.paidAt) row.paidAt = changes.paidAt;
    return { ...row };
  }
  async updateProgress(id: string, confirmations: number, payment?: PaymentRef) {
    const row = this.rows.get(id)!;
    row.confirmations = confirmations;
    if (payment) row.payment = payment;
  }
}

type StoredDelivery = WebhookDelivery & { status: string; nextAttemptAt: Date; lastError?: string };

class MemoryWebhooks implements WebhookRepository {
  readonly rows: StoredDelivery[] = [];
  async enqueue(d: NewWebhookDelivery) {
    this.rows.push({ ...d, attempts: 0, status: 'pending', nextAttemptAt: new Date(0) });
  }
  async claimDue(now: Date, limit: number) {
    const due = this.rows.filter((r) => r.status === 'pending' && r.nextAttemptAt <= now).slice(0, limit);
    for (const r of due) {
      r.attempts++;
      r.nextAttemptAt = new Date(now.getTime() + 60_000);
    }
    return due.map((r) => ({ ...r }));
  }
  async markDelivered(id: string) {
    this.rows.find((r) => r.id === id)!.status = 'delivered';
  }
  async markFailed(id: string, error: string, retryAt: Date | null) {
    const row = this.rows.find((r) => r.id === id)!;
    row.lastError = error;
    row.status = retryAt ? 'pending' : 'failed';
    if (retryAt) row.nextAttemptAt = retryAt;
  }
}

class MemoryCursors implements CursorRepository {
  readonly rows = new Map<number, BlockRef>();
  async get(chainId: number) {
    return this.rows.get(chainId) ?? null;
  }
  async save(chainId: number, block: BlockRef) {
    this.rows.set(chainId, block);
  }
  async rewind(chainId: number, block: BlockRef) {
    const current = this.rows.get(chainId);
    if (current && current.number > block.number) this.rows.set(chainId, block);
  }
}

export function memoryRepositories() {
  const repos = {
    merchants: new MemoryMerchants(),
    invoices: new MemoryInvoices(),
    webhooks: new MemoryWebhooks(),
    cursors: new MemoryCursors(),
  } satisfies Repositories;
  const uow: UnitOfWork = { run: (work) => work(repos) };
  return { repos, uow };
}

/** A tiny programmable blockchain: one block every 2 seconds starting at `genesis`. */
export class FakeChain implements ChainClient, ChainClients {
  head = 1000n;
  readonly txs = new Map<string, TxInspection>();
  constructor(private readonly genesis: Date) {}

  blockTime(n: bigint) {
    return new Date(this.genesis.getTime() + Number(n) * 2000);
  }
  forChain() {
    return this;
  }
  async getHead() {
    return { number: this.head, time: this.blockTime(this.head) };
  }
  async getBlock(n: bigint) {
    return { number: n, time: this.blockTime(n) };
  }
  async inspectTransaction(hash: string) {
    return this.txs.get(hash) ?? { status: 'not_found' as const };
  }
  async findTransfers(q: TransferQuery) {
    return [...this.txs.values()]
      .flatMap((tx) => (tx.status === 'success' ? tx.transfers : []))
      .filter(
        (t) => t.token === q.token && q.recipients.includes(t.to) && t.blockNumber >= q.fromBlock && t.blockNumber <= q.toBlock,
      );
  }

  /** Mines a block with a single token transfer and returns it. */
  pay(to: string, value: bigint, opts: { token?: string; hash?: string } = {}): TokenTransfer {
    this.head += 1n;
    const transfer: TokenTransfer = {
      chainId: testChain.id,
      txHash: opts.hash ?? `0x${this.head.toString(16).padStart(64, '0')}`,
      logIndex: 0,
      blockNumber: this.head,
      blockHash: `0xb${this.head.toString(16).padStart(63, '0')}`,
      blockTime: this.blockTime(this.head),
      token: opts.token ?? TOKEN,
      from: CUSTOMER_WALLET,
      to,
      value,
    };
    this.txs.set(transfer.txHash, { status: 'success', transfers: [transfer] });
    return transfer;
  }

  mine(blocks: number) {
    this.head += BigInt(blocks);
  }
}

export class RecordingSender implements WebhookSender {
  readonly requests: WebhookRequest[] = [];
  constructor(public respond: () => WebhookResult = () => ({ ok: true, status: 200 })) {}
  async send(request: WebhookRequest) {
    this.requests.push(request);
    return this.respond();
  }
}
