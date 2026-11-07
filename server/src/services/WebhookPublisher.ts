import { randomUUID } from 'node:crypto';
import type { Invoice } from '../domain/invoice.js';
import type { WebhookEvent } from '../domain/webhook.js';
import type { Repositories } from '../ports/repositories.js';
import type { Clock } from '../ports/system.js';
import type { Presenter } from './presenter.js';

/**
 * Records a webhook in the outbox. It is called inside the same database
 * transaction as the status change, so an event is never lost or sent for a
 * change that was rolled back (transactional outbox pattern).
 */
export class WebhookPublisher {
  constructor(
    private readonly presenter: Presenter,
    private readonly clock: Clock,
  ) {}

  async publish(repos: Repositories, invoice: Invoice, event: WebhookEvent): Promise<void> {
    const merchant = await repos.merchants.findById(invoice.merchantId);
    if (!merchant?.webhookUrl) return;
    const id = randomUUID();
    await repos.webhooks.enqueue({
      id,
      merchantId: merchant.id,
      invoiceId: invoice.id,
      event,
      url: merchant.webhookUrl,
      payload: {
        id,
        type: event,
        createdAt: this.clock.now().toISOString(),
        data: this.presenter.invoice(invoice),
      },
    });
  }
}
