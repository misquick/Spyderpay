import { isAddress, type Chain } from 'viem';
import { base, baseSepolia, hardhat, mainnet, polygon, polygonAmoy, sepolia } from 'viem/chains';
import { AppError } from '../domain/errors.js';
import { NATIVE, type InvoiceToken } from '../domain/invoice.js';

export interface ChainConfig {
  id: number;
  name: string;
  testnet: boolean;
  /** What invoices on this chain are paid in. `precision` = decimals a merchant may enter. */
  token: InvoiceToken & { precision: number };
  confirmations: number;
  /** Server-side RPC (may contain an API key — never sent to the browser). */
  rpcUrl: string | undefined;
  /** Public RPC the browser may use. */
  publicRpcUrl: string;
  explorerUrl: string | null;
  faucetUrl: string | null;
  viem: Chain;
}

interface Preset {
  chain: Chain;
  /** null = must be provided via TOKEN_ADDRESS_<id> (local chains). */
  usdc: string | null;
  confirmations: number;
  faucetUrl?: string;
  /** Where to get the chain's own test coin. */
  nativeFaucetUrl?: string;
}

const CIRCLE_FAUCET = 'https://faucet.circle.com';

/**
 * Supported networks. USDC addresses are Circle's official deployments.
 * Adding a network = adding one entry here (Open/Closed principle).
 */
const PRESETS: Record<number, Preset> = {
  [baseSepolia.id]: { chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', confirmations: 5, faucetUrl: CIRCLE_FAUCET, nativeFaucetUrl: 'https://docs.base.org/base-chain/tools/network-faucets' },
  [sepolia.id]: { chain: sepolia, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', confirmations: 3, faucetUrl: CIRCLE_FAUCET, nativeFaucetUrl: 'https://ethereum.org/developers/docs/networks/#sepolia' },
  [polygonAmoy.id]: { chain: polygonAmoy, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', confirmations: 10, faucetUrl: CIRCLE_FAUCET, nativeFaucetUrl: 'https://faucet.polygon.technology' },
  [base.id]: { chain: base, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', confirmations: 10 },
  [mainnet.id]: { chain: mainnet, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', confirmations: 12 },
  [polygon.id]: { chain: polygon, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', confirmations: 32 },
  [hardhat.id]: { chain: hardhat, usdc: null, confirmations: 2 },
};

export const SUPPORTED_CHAIN_IDS = Object.keys(PRESETS).map(Number);

export class ChainRegistry {
  private readonly byId: Map<number, ChainConfig>;

  constructor(private readonly chains: ChainConfig[]) {
    if (chains.length === 0) throw new Error('At least one chain must be enabled');
    this.byId = new Map(chains.map((c) => [c.id, c]));
  }

  list(): readonly ChainConfig[] {
    return this.chains;
  }

  get default(): ChainConfig {
    return this.chains[0]!;
  }

  find(id: number): ChainConfig | undefined {
    return this.byId.get(id);
  }

  get(id: number): ChainConfig {
    const chain = this.byId.get(id);
    if (!chain) throw new AppError(400, 'UNSUPPORTED_CHAIN', `Chain ${id} is not enabled on this server`);
    return chain;
  }
}

export function buildChainRegistry(ids: number[], env: Record<string, string | undefined>): ChainRegistry {
  const chains = ids.map((id): ChainConfig => {
    const preset = PRESETS[id];
    if (!preset) {
      throw new Error(`Chain ${id} is not supported. Supported: ${SUPPORTED_CHAIN_IDS.join(', ')}`);
    }
    // PAY_ASSET=ETH (default) → the chain's own coin; PAY_ASSET=USDC → the ERC-20 token.
    const asset = (env[`PAY_ASSET_${id}`] ?? env.PAY_ASSET ?? 'ETH').trim().toUpperCase();
    const native = asset !== 'USDC' && asset !== 'TOKEN';
    const tokenAddress = env[`TOKEN_ADDRESS_${id}`] ?? preset.usdc;
    if (!native && (!tokenAddress || !isAddress(tokenAddress))) {
      throw new Error(`TOKEN_ADDRESS_${id} must be set to a valid ERC-20 address`);
    }
    const confirmations = Number(env[`CONFIRMATIONS_${id}`] ?? preset.confirmations);
    if (!Number.isInteger(confirmations) || confirmations < 1) {
      throw new Error(`CONFIRMATIONS_${id} must be a positive integer`);
    }
    const publicRpcUrl = preset.chain.rpcUrls.default.http[0];
    if (!publicRpcUrl) throw new Error(`Chain ${id} has no public RPC`);
    return {
      id,
      name: preset.chain.name,
      testnet: preset.chain.testnet ?? id === hardhat.id,
      token: native
        ? { address: NATIVE, symbol: preset.chain.nativeCurrency.symbol, decimals: preset.chain.nativeCurrency.decimals, precision: 6 }
        : {
            address: tokenAddress!.toLowerCase(),
            symbol: env[`TOKEN_SYMBOL_${id}`] ?? 'USDC',
            decimals: Number(env[`TOKEN_DECIMALS_${id}`] ?? 6),
            precision: 2,
          },
      confirmations,
      rpcUrl: env[`RPC_URL_${id}`] || undefined,
      publicRpcUrl,
      explorerUrl: preset.chain.blockExplorers?.default.url ?? null,
      faucetUrl: (native ? preset.nativeFaucetUrl : preset.faucetUrl) ?? null,
      viem: preset.chain,
    };
  });
  return new ChainRegistry(chains);
}
