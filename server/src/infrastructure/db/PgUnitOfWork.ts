import type { Pool } from 'pg';
import type { Repositories, UnitOfWork } from '../../ports/repositories.js';
import { PgCursorRepository } from './PgCursorRepository.js';
import { PgInvoiceRepository } from './PgInvoiceRepository.js';
import { PgMerchantRepository } from './PgMerchantRepository.js';
import { PgWebhookRepository } from './PgWebhookRepository.js';
import type { Queryable } from './queryable.js';

export const createPgRepositories = (db: Queryable): Repositories => ({
  merchants: new PgMerchantRepository(db),
  invoices: new PgInvoiceRepository(db),
  webhooks: new PgWebhookRepository(db),
  cursors: new PgCursorRepository(db),
});

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(createPgRepositories(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
