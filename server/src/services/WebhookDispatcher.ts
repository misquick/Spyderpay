import { MAX_WEBHOOK_ATTEMPTS, retryDelayMs, signatureHeader } from '../domain/webhook.js';
import type { Repositories } from '../ports/repositories.js';
import type { Clock, Logger, WebhookSender } from '../ports/system.js';

/** Delivers queued webhooks with an HMAC signature and retries failures with back-off. */
export class WebhookDispatcher {
  constructor(
    private readonly repos: Repositories,
    private readonly sender: WebhookSender,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly batchSize = 20,
  ) {}

  async run(): Promise<void> {
    const due = await this.repos.webhooks.claimDue(this.clock.now(), this.batchSize);
    for (const delivery of due) {
      const merchant = await this.repos.merchants.findById(delivery.merchantId);
      if (!merchant) {
        await this.repos.webhooks.markFailed(delivery.id, 'merchant not found', null);
        continue;
      }
      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(this.clock.now().getTime() / 1000);
      const result = await this.sender.send({
        url: delivery.url,
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'CryptoPay-Webhooks/1.0',
          'x-cryptopay-event': delivery.event,
          'x-cryptopay-delivery': delivery.id,
          'x-cryptopay-signature': signatureHeader(merchant.webhookSecret, timestamp, body),
        },
      });

      if (result.ok) {
        await this.repos.webhooks.markDelivered(delivery.id, this.clock.now());
        continue;
      }
      const giveUp = delivery.attempts >= MAX_WEBHOOK_ATTEMPTS;
      const retryAt = giveUp ? null : new Date(this.clock.now().getTime() + retryDelayMs(delivery.attempts));
      await this.repos.webhooks.markFailed(delivery.id, result.error, retryAt);
      this.logger.warn('webhook delivery failed', {
        deliveryId: delivery.id,
        attempt: delivery.attempts,
        error: result.error,
        retryAt: retryAt?.toISOString() ?? 'never',
      });
    }
  }
}
