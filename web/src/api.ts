/** Typed client for the CryptoPay API. Shapes mirror server/src/services/presenter.ts. */

export type Address = `0x${string}`;
export type InvoiceStatus = 'pending' | 'confirming' | 'paid' | 'expired' | 'cancelled';

export interface Token {
  /** null = the chain's own coin (ETH). */
  address: Address | null;
  symbol: string;
  decimals: number;
}

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  amount: string;
  payAmount: string;
  payAmountUnits: string;
  token: Token;
  network: { chainId: number; name: string; testnet: boolean; explorerUrl: string | null; faucetUrl: string | null };
  payTo: Address;
  description: string | null;
  orderId?: string | null;
  redirectUrl: string | null;
  payment: { txHash: string; payer: Address; blockNumber: string; explorerUrl: string | null } | null;
  confirmations: number;
  requiredConfirmations: number | null;
  paymentUrl: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  merchant?: { name: string };
}

export interface ChainInfo {
  chainId: number;
  name: string;
  testnet: boolean;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorerUrl: string | null;
  faucetUrl: string | null;
  confirmations: number;
  token: Token & { precision: number };
}

export interface AppConfig {
  appName: string;
  reownProjectId: string | null;
  registrationOpen: boolean;
  defaultChainId: number;
  chains: ChainInfo[];
}

export interface Merchant {
  id: string;
  name: string;
  payoutAddress: Address;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: string;
}

export interface CreateInvoiceInput {
  amount: string;
  chainId?: number;
  description?: string;
  orderId?: string;
  redirectUrl?: string;
  expiresInMinutes?: number;
  payTo?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; apiKey?: string } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(response.status, error.code ?? 'HTTP_' + response.status, error.message ?? response.statusText, error.details);
  }
  return data as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),

  register: (body: { name: string; payoutAddress: string; webhookUrl: string | null }) =>
    request<{ merchant: Merchant; apiKey: string }>('/api/merchants', { method: 'POST', body }),
  me: (apiKey: string) => request<{ merchant: Merchant }>('/api/merchants/me', { apiKey }).then((r) => r.merchant),
  updateMe: (apiKey: string, body: Partial<Pick<Merchant, 'name' | 'payoutAddress' | 'webhookUrl'>>) =>
    request<{ merchant: Merchant }>('/api/merchants/me', { method: 'PATCH', body, apiKey }).then((r) => r.merchant),

  createInvoice: (apiKey: string, body: CreateInvoiceInput) =>
    request<{ invoice: Invoice }>('/api/invoices', { method: 'POST', body, apiKey }).then((r) => r.invoice),
  listInvoices: (apiKey: string) =>
    request<{ invoices: Invoice[] }>('/api/invoices?limit=100', { apiKey }).then((r) => r.invoices),
  cancelInvoice: (apiKey: string, id: string) =>
    request<{ invoice: Invoice }>(`/api/invoices/${id}/cancel`, { method: 'POST', apiKey }).then((r) => r.invoice),

  publicInvoice: (id: string) =>
    request<{ invoice: Invoice }>(`/api/public/invoices/${encodeURIComponent(id)}`).then((r) => r.invoice),
  submitPayment: (id: string, txHash: string) =>
    request<{ invoice: Invoice }>(`/api/public/invoices/${encodeURIComponent(id)}/payments`, {
      method: 'POST',
      body: { txHash },
    }).then((r) => r.invoice),
};

export const isFinal = (status: InvoiceStatus) => status === 'paid' || status === 'expired' || status === 'cancelled';

/** Reports a mined transaction to the server, retrying while the server's node has not seen it yet. */
export async function reportPayment(invoiceId: string, txHash: string, attempts = 8): Promise<Invoice> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api.submitPayment(invoiceId, txHash);
    } catch (error) {
      const retry = error instanceof ApiError && (error.code === 'TX_NOT_FOUND' || error.status === 0);
      if (!retry || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
}
