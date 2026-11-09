import { randomUUID } from 'node:crypto';
import type { ChainRegistry } from '../config/chains.js';
import { AppError, DuplicateAmountError, notFound } from '../domain/errors.js';
import { assertTransition, type Invoice } from '../domain/invoice.js';
import type { Merchant } from '../domain/merchant.js';
import { normalizeAmount, toUnits, withUniqueTail } from '../domain/money.js';
import type { InvoiceRepository, MerchantRepository } from '../ports/repositories.js';
import type { Clock } from '../ports/system.js';

export interface CreateInvoiceInput {
  amount: string;
  chainId?: number;
  description?: string;
  orderId?: string;
  redirectUrl?: string;
  expiresInMinutes?: number;
  /** Pay to another address than the merchant's default (e.g. the test page). */
  payTo?: string;
}

const MAX_TAIL_ATTEMPTS = 25;

/** Creating, reading and cancelling invoices. Knows nothing about blockchains or HTTP. */
export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly merchants: MerchantRepository,
    private readonly chains: ChainRegistry,
    private readonly clock: Clock,
    private readonly defaultTtlMinutes: number,
    private readonly pickTail?: () => number,
  ) {}

  async create(merchant: Merchant, input: CreateInvoiceInput): Promise<Invoice> {
    const chain = input.chainId === undefined ? this.chains.default : this.chains.get(input.chainId);
    const { precision } = chain.token;
    const base = toUnits(input.amount, chain.token.decimals, precision);
    const now = this.clock.now();
    const ttl = input.expiresInMinutes ?? this.defaultTtlMinutes;

    // Retry with a different random tail until the exact amount is unique among open invoices.
    for (let attempt = 0; attempt < MAX_TAIL_ATTEMPTS; attempt++) {
      try {
        return await this.invoices.insert({
          id: randomUUID(),
          merchantId: merchant.id,
          chainId: chain.id,
          token: { address: chain.token.address, symbol: chain.token.symbol, decimals: chain.token.decimals },
          payTo: (input.payTo ?? merchant.payoutAddress).toLowerCase(),
          amount: normalizeAmount(input.amount, precision),
          amountUnits: withUniqueTail(base, chain.token.decimals, this.pickTail, precision),
          description: input.description ?? null,
          orderId: input.orderId ?? null,
          redirectUrl: input.redirectUrl ?? null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + ttl * 60_000),
        });
      } catch (error) {
        if (!(error instanceof DuplicateAmountError)) throw error;
      }
    }
    throw new AppError(503, 'AMOUNT_SPACE_EXHAUSTED', 'Too many open invoices for this amount, try again later');
  }

  list(merchant: Merchant, limit = 50): Promise<Invoice[]> {
    return this.invoices.listByMerchant(merchant.id, limit);
  }

  async getForMerchant(merchant: Merchant, id: string): Promise<Invoice> {
    const invoice = await this.invoices.findById(id);
    if (!invoice || invoice.merchantId !== merchant.id) throw notFound('Invoice');
    return invoice;
  }

  async getPublic(id: string): Promise<{ invoice: Invoice; merchant: Merchant }> {
    const invoice = await this.invoices.findById(id);
    const merchant = invoice && (await this.merchants.findById(invoice.merchantId));
    if (!invoice || !merchant) throw notFound('Invoice');
    return { invoice, merchant };
  }

  async cancel(merchant: Merchant, id: string): Promise<Invoice> {
    const invoice = await this.getForMerchant(merchant, id);
    assertTransition(invoice.status, 'cancelled');
    const updated = await this.invoices.transition(id, invoice.status, 'cancelled');
    if (!updated) throw new AppError(409, 'INVALID_STATE', 'Invoice changed while cancelling, reload and retry');
    return updated;
  }
}
