import { DuplicateAmountError, PaymentAlreadyUsedError } from '../../domain/errors.js';
import type { Invoice, InvoiceStatus, NewInvoice, PaymentRef } from '../../domain/invoice.js';
import type { InvoiceRepository, TransitionChanges } from '../../ports/repositories.js';
import { isUniqueViolation, queryOne, type Queryable } from './queryable.js';

interface InvoiceRow {
  id: string;
  merchant_id: string;
  status: InvoiceStatus;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  token_decimals: number;
  pay_to: string;
  amount: string;
  amount_units: string;
  description: string | null;
  order_id: string | null;
  redirect_url: string | null;
  tx_hash: string | null;
  log_index: number | null;
  block_number: string | null;
  block_hash: string | null;
  payer_address: string | null;
  confirmations: number;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
  updated_at: Date;
}

const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  merchantId: r.merchant_id,
  status: r.status,
  chainId: r.chain_id,
  token: { address: r.token_address, symbol: r.token_symbol, decimals: r.token_decimals },
  payTo: r.pay_to,
  amount: r.amount,
  amountUnits: BigInt(r.amount_units),
  description: r.description,
  orderId: r.order_id,
  redirectUrl: r.redirect_url,
  payment:
    r.tx_hash === null
      ? null
      : {
          txHash: r.tx_hash,
          logIndex: r.log_index!,
          blockNumber: BigInt(r.block_number!),
          blockHash: r.block_hash!,
          payer: r.payer_address!,
        },
  confirmations: r.confirmations,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  paidAt: r.paid_at,
  updatedAt: r.updated_at,
});

const paymentParams = (p: PaymentRef | null) =>
  p === null ? [null, null, null, null, null] : [p.txHash, p.logIndex, p.blockNumber.toString(), p.blockHash, p.payer];

export class PgInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Queryable) {}

  async insert(i: NewInvoice): Promise<Invoice> {
    try {
      const row = await queryOne<InvoiceRow>(
        this.db,
        `INSERT INTO invoices (id, merchant_id, status, chain_id, token_address, token_symbol, token_decimals,
                               pay_to, amount, amount_units, description, order_id, redirect_url, created_at, expires_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          i.id, i.merchantId, i.chainId, i.token.address, i.token.symbol, i.token.decimals, i.payTo,
          i.amount, i.amountUnits.toString(), i.description, i.orderId, i.redirectUrl, i.createdAt, i.expiresAt,
        ],
      );
      return toInvoice(row!);
    } catch (error) {
      if (isUniqueViolation(error, 'invoices_open_amount_uq')) throw new DuplicateAmountError();
      throw error;
    }
  }

  async findById(id: string): Promise<Invoice | null> {
    const row = await queryOne<InvoiceRow>(this.db, 'SELECT * FROM invoices WHERE id = $1', [id]);
    return row && toInvoice(row);
  }

  async listByMerchant(merchantId: string, limit: number): Promise<Invoice[]> {
    const { rows } = await this.db.query<InvoiceRow>(
      'SELECT * FROM invoices WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2',
      [merchantId, limit],
    );
    return rows.map(toInvoice);
  }

  async listByStatus(chainId: number, status: InvoiceStatus): Promise<Invoice[]> {
    const { rows } = await this.db.query<InvoiceRow>(
      'SELECT * FROM invoices WHERE chain_id = $1 AND status = $2 ORDER BY created_at LIMIT 1000',
      [chainId, status],
    );
    return rows.map(toInvoice);
  }

  async listExpired(chainId: number, asOf: Date): Promise<Invoice[]> {
    const { rows } = await this.db.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE chain_id = $1 AND status = 'pending' AND expires_at < $2 LIMIT 500`,
      [chainId, asOf],
    );
    return rows.map(toInvoice);
  }

  async transition(id: string, from: InvoiceStatus, to: InvoiceStatus, changes: TransitionChanges = {}): Promise<Invoice | null> {
    const setPayment = changes.payment !== undefined;
    try {
      const row = await queryOne<InvoiceRow>(
        this.db,
        `UPDATE invoices SET
           status        = $3,
           tx_hash       = CASE WHEN $4::boolean THEN $5 ELSE tx_hash END,
           log_index     = CASE WHEN $4::boolean THEN $6::integer ELSE log_index END,
           block_number  = CASE WHEN $4::boolean THEN $7::bigint ELSE block_number END,
           block_hash    = CASE WHEN $4::boolean THEN $8 ELSE block_hash END,
           payer_address = CASE WHEN $4::boolean THEN $9 ELSE payer_address END,
           confirmations = COALESCE($10, confirmations),
           paid_at       = COALESCE($11, paid_at),
           updated_at    = now()
         WHERE id = $1 AND status = $2
         RETURNING *`,
        [id, from, to, setPayment, ...paymentParams(changes.payment ?? null), changes.confirmations ?? null, changes.paidAt ?? null],
      );
      return row && toInvoice(row);
    } catch (error) {
      if (isUniqueViolation(error, 'invoices_payment_uq')) throw new PaymentAlreadyUsedError();
      throw error;
    }
  }

  async updateProgress(id: string, confirmations: number, payment?: PaymentRef): Promise<void> {
    await this.db.query(
      `UPDATE invoices SET
         confirmations = $2,
         tx_hash       = CASE WHEN $3::boolean THEN $4 ELSE tx_hash END,
         log_index     = CASE WHEN $3::boolean THEN $5::integer ELSE log_index END,
         block_number  = CASE WHEN $3::boolean THEN $6::bigint ELSE block_number END,
         block_hash    = CASE WHEN $3::boolean THEN $7 ELSE block_hash END,
         payer_address = CASE WHEN $3::boolean THEN $8 ELSE payer_address END,
         updated_at    = now()
       WHERE id = $1`,
      [id, confirmations, payment !== undefined, ...paymentParams(payment ?? null)],
    );
  }
}
