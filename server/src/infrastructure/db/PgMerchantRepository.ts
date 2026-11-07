import { notFound } from '../../domain/errors.js';
import type { Merchant, MerchantPatch, NewMerchant } from '../../domain/merchant.js';
import type { MerchantRepository } from '../../ports/repositories.js';
import { queryOne, type Queryable } from './queryable.js';

interface MerchantRow {
  id: string;
  name: string;
  payout_address: string;
  webhook_url: string | null;
  webhook_secret: string;
  created_at: Date;
}

const toMerchant = (r: MerchantRow): Merchant => ({
  id: r.id,
  name: r.name,
  payoutAddress: r.payout_address,
  webhookUrl: r.webhook_url,
  webhookSecret: r.webhook_secret,
  createdAt: r.created_at,
});

const COLUMNS = 'id, name, payout_address, webhook_url, webhook_secret, created_at';

export class PgMerchantRepository implements MerchantRepository {
  constructor(private readonly db: Queryable) {}

  async create(m: NewMerchant): Promise<Merchant> {
    const row = await queryOne<MerchantRow>(
      this.db,
      `INSERT INTO merchants (id, name, payout_address, webhook_url, webhook_secret, api_key_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [m.id, m.name, m.payoutAddress, m.webhookUrl, m.webhookSecret, m.apiKeyHash],
    );
    return toMerchant(row!);
  }

  async findById(id: string): Promise<Merchant | null> {
    const row = await queryOne<MerchantRow>(this.db, `SELECT ${COLUMNS} FROM merchants WHERE id = $1`, [id]);
    return row && toMerchant(row);
  }

  async findByApiKeyHash(hash: string): Promise<Merchant | null> {
    const row = await queryOne<MerchantRow>(this.db, `SELECT ${COLUMNS} FROM merchants WHERE api_key_hash = $1`, [hash]);
    return row && toMerchant(row);
  }

  async update(id: string, patch: MerchantPatch): Promise<Merchant> {
    const row = await queryOne<MerchantRow>(
      this.db,
      `UPDATE merchants SET
         name           = COALESCE($2, name),
         payout_address = COALESCE($3, payout_address),
         webhook_url    = CASE WHEN $4::boolean THEN $5 ELSE webhook_url END
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, patch.name ?? null, patch.payoutAddress ?? null, patch.webhookUrl !== undefined, patch.webhookUrl ?? null],
    );
    if (!row) throw notFound('Merchant');
    return toMerchant(row);
  }
}
