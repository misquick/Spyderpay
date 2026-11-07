import type { NewWebhookDelivery, WebhookDelivery, WebhookEvent } from '../../domain/webhook.js';
import type { WebhookRepository } from '../../ports/repositories.js';
import type { Queryable } from './queryable.js';

interface DeliveryRow {
  id: string;
  merchant_id: string;
  invoice_id: string;
  event: WebhookEvent;
  url: string;
  payload: unknown;
  attempts: number;
}

/** How long a claimed delivery is reserved for the worker that claimed it. */
const LEASE_SECONDS = 60;

export class PgWebhookRepository implements WebhookRepository {
  constructor(private readonly db: Queryable) {}

  async enqueue(d: NewWebhookDelivery): Promise<void> {
    await this.db.query(
      `INSERT INTO webhook_deliveries (id, merchant_id, invoice_id, event, url, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [d.id, d.merchantId, d.invoiceId, d.event, d.url, JSON.stringify(d.payload)],
    );
  }

  async claimDue(now: Date, limit: number): Promise<WebhookDelivery[]> {
    const { rows } = await this.db.query<DeliveryRow>(
      `UPDATE webhook_deliveries SET
         attempts = attempts + 1,
         next_attempt_at = $1::timestamptz + make_interval(secs => ${LEASE_SECONDS})
       WHERE id IN (
         SELECT id FROM webhook_deliveries
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, merchant_id, invoice_id, event, url, payload, attempts`,
      [now, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      invoiceId: r.invoice_id,
      event: r.event,
      url: r.url,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async markDelivered(id: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE webhook_deliveries SET status = 'delivered', delivered_at = $2, last_error = NULL WHERE id = $1`,
      [id, at],
    );
  }

  async markFailed(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.db.query(
      `UPDATE webhook_deliveries SET
         status = CASE WHEN $3::timestamptz IS NULL THEN 'failed' ELSE 'pending' END,
         next_attempt_at = COALESCE($3, next_attempt_at),
         last_error = $2
       WHERE id = $1`,
      [id, error.slice(0, 500), retryAt],
    );
  }
}
