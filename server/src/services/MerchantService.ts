import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Merchant, MerchantPatch } from '../domain/merchant.js';
import type { MerchantRepository } from '../ports/repositories.js';

export interface RegisterMerchantInput {
  name: string;
  payoutAddress: string;
  webhookUrl: string | null;
}

const API_KEY_PREFIX = 'cpk_';

export const hashApiKey = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex');

/** Merchant accounts and API-key authentication. */
export class MerchantService {
  constructor(private readonly merchants: MerchantRepository) {}

  /** The plain API key is returned exactly once; only its hash is stored. */
  async register(input: RegisterMerchantInput): Promise<{ merchant: Merchant; apiKey: string }> {
    const apiKey = API_KEY_PREFIX + randomBytes(24).toString('base64url');
    const merchant = await this.merchants.create({
      id: randomUUID(),
      name: input.name,
      payoutAddress: input.payoutAddress.toLowerCase(),
      webhookUrl: input.webhookUrl,
      webhookSecret: 'whsec_' + randomBytes(24).toString('base64url'),
      apiKeyHash: hashApiKey(apiKey),
    });
    return { merchant, apiKey };
  }

  async authenticate(apiKey: string): Promise<Merchant | null> {
    if (!apiKey.startsWith(API_KEY_PREFIX)) return null;
    return this.merchants.findByApiKeyHash(hashApiKey(apiKey));
  }

  /** A new payout address only affects invoices created afterwards. */
  async update(merchantId: string, patch: MerchantPatch): Promise<Merchant> {
    return this.merchants.update(merchantId, {
      ...patch,
      ...(patch.payoutAddress ? { payoutAddress: patch.payoutAddress.toLowerCase() } : {}),
    });
  }
}
