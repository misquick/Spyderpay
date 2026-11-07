import { getAddress } from 'viem';
import type { ChainConfig, ChainRegistry } from '../config/chains.js';
import type { Invoice } from '../domain/invoice.js';
import type { Merchant } from '../domain/merchant.js';
import { fromUnits } from '../domain/money.js';

/** Turns domain objects into the JSON shapes the API and webhooks expose. */
export class Presenter {
  constructor(
    private readonly chains: ChainRegistry,
    private readonly publicUrl: string,
  ) {}

  invoice(invoice: Invoice) {
    const chain = this.chains.find(invoice.chainId);
    const explorer = chain?.explorerUrl ?? null;
    return {
      id: invoice.id,
      status: invoice.status,
      amount: invoice.amount,
      payAmount: fromUnits(invoice.amountUnits, invoice.token.decimals),
      payAmountUnits: invoice.amountUnits.toString(),
      token: {
        address: getAddress(invoice.token.address),
        symbol: invoice.token.symbol,
        decimals: invoice.token.decimals,
      },
      network: {
        chainId: invoice.chainId,
        name: chain?.name ?? `Chain ${invoice.chainId}`,
        testnet: chain?.testnet ?? false,
        explorerUrl: explorer,
        faucetUrl: chain?.faucetUrl ?? null,
      },
      payTo: getAddress(invoice.payTo),
      description: invoice.description,
      orderId: invoice.orderId,
      redirectUrl: invoice.redirectUrl,
      payment: invoice.payment && {
        txHash: invoice.payment.txHash,
        payer: getAddress(invoice.payment.payer),
        blockNumber: invoice.payment.blockNumber.toString(),
        explorerUrl: explorer ? `${explorer}/tx/${invoice.payment.txHash}` : null,
      },
      confirmations: invoice.confirmations,
      requiredConfirmations: chain?.confirmations ?? null,
      paymentUrl: `${this.publicUrl}/pay/${invoice.id}`,
      createdAt: invoice.createdAt.toISOString(),
      expiresAt: invoice.expiresAt.toISOString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
    };
  }

  /** What the customer's payment page may see: no merchant-internal fields. */
  publicInvoice(invoice: Invoice, merchant: Merchant) {
    const { orderId: _orderId, ...rest } = this.invoice(invoice);
    return { ...rest, merchant: { name: merchant.name } };
  }

  merchant(merchant: Merchant) {
    return {
      id: merchant.id,
      name: merchant.name,
      payoutAddress: getAddress(merchant.payoutAddress),
      webhookUrl: merchant.webhookUrl,
      webhookSecret: merchant.webhookSecret,
      createdAt: merchant.createdAt.toISOString(),
    };
  }

  chain(chain: ChainConfig) {
    return {
      chainId: chain.id,
      name: chain.name,
      testnet: chain.testnet,
      nativeCurrency: chain.viem.nativeCurrency,
      rpcUrl: chain.publicRpcUrl,
      explorerUrl: chain.explorerUrl,
      faucetUrl: chain.faucetUrl,
      confirmations: chain.confirmations,
      token: { address: getAddress(chain.token.address), symbol: chain.token.symbol, decimals: chain.token.decimals },
    };
  }
}

export type InvoiceDto = ReturnType<Presenter['invoice']>;
