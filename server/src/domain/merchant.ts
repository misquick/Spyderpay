export interface Merchant {
  id: string;
  name: string;
  /** Lower-case EVM address that receives all payments. */
  payoutAddress: string;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: Date;
}

export interface NewMerchant {
  id: string;
  name: string;
  payoutAddress: string;
  webhookUrl: string | null;
  webhookSecret: string;
  apiKeyHash: string;
}

export type MerchantPatch = Partial<Pick<Merchant, 'name' | 'payoutAddress' | 'webhookUrl'>>;
