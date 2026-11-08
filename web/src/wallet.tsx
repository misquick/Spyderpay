import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createAppKit, useAppKit } from '@reown/appkit/react';
import { useState } from 'react';
import { defineChain, type Chain } from 'viem';
import { base, baseSepolia, hardhat, mainnet, polygon, polygonAmoy, sepolia } from 'viem/chains';
import { createConfig, http, useConnect, useConnection, useConnectors, useDisconnect, type Config } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { AppConfig, ChainInfo } from './api';
import { shortAddress } from './format';
import { walletErrorMessage } from './text';
import { ExternalLink, MenuItem, Notice } from './ui';

/**
 * Wallet integration.
 *
 * With VITE_REOWN_PROJECT_ID set, Reown AppKit (WalletConnect) is used: one modal
 * for MetaMask, Trust Wallet, Phantom and 500+ other wallets, browser extensions
 * and mobile apps via QR code. Without it, the app falls back to wallets injected
 * into the browser (EIP-6963), which is enough for local development.
 */

/** WalletConnect registry ids, shown first in the AppKit modal. */
const FEATURED_WALLETS = [
  'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
  '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd0d4d4e1a5', // Trust Wallet
  'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393', // Phantom
];

const KNOWN_CHAINS = new Map<number, Chain>(
  [base, baseSepolia, hardhat, mainnet, polygon, polygonAmoy, sepolia].map((c) => [c.id, c]),
);

/** The server decides which networks are enabled; the browser builds chain objects from that. */
function toChain(info: ChainInfo): Chain {
  return (
    KNOWN_CHAINS.get(info.chainId) ??
    defineChain({
      id: info.chainId,
      name: info.name,
      nativeCurrency: info.nativeCurrency,
      rpcUrls: { default: { http: [info.rpcUrl] } },
      blockExplorers: info.explorerUrl ? { default: { name: 'Explorer', url: info.explorerUrl } } : undefined,
      testnet: info.testnet,
    })
  );
}

type Mode = 'appkit' | 'browser';
let mode: Mode = 'browser';

export function setupWallet(config: AppConfig): Config {
  const chains = config.chains.map(toChain) as [Chain, ...Chain[]];
  const projectId = config.reownProjectId || import.meta.env.VITE_REOWN_PROJECT_ID?.trim();

  if (projectId) {
    const adapter = new WagmiAdapter({ networks: chains, projectId });
    createAppKit({
      adapters: [adapter],
      networks: chains,
      projectId,
      metadata: {
        name: config.appName,
        description: 'Оплата счетов в USDC',
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      },
      themeMode: 'dark',
      themeVariables: {
        '--w3m-accent': '#C9A25A',
        '--w3m-font-family': '"Cormorant Garamond", Georgia, serif',
        '--w3m-color-mix': '#1F150A',
        '--w3m-color-mix-strength': 35,
        '--w3m-border-radius-master': '2px',
      },
      featuredWalletIds: FEATURED_WALLETS,
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false, receive: false },
    });
    mode = 'appkit';
    return adapter.wagmiConfig;
  }

  mode = 'browser';
  return createConfig({
    chains,
    connectors: [injected()],
    transports: Object.fromEntries(chains.map((c) => [c.id, http()])),
  });
}

type ConnectStyle = 'menu' | 'link';

/** "Connect wallet" — a menu entry (or a small link) that opens the AppKit modal or a list of browser wallets. */
export function ConnectWallet({ label = 'Подключить кошелёк', variant = 'menu' }: { label?: string; variant?: ConnectStyle }) {
  return mode === 'appkit' ? <AppKitConnect label={label} variant={variant} /> : <BrowserConnect label={label} variant={variant} />;
}

function Trigger({ variant, label, onClick, busy }: { variant: ConnectStyle; label: string; onClick: () => void; busy?: boolean }) {
  return variant === 'link' ? (
    <button type="button" className="link-button" onClick={onClick} disabled={busy}>
      {label}
    </button>
  ) : (
    <MenuItem onClick={onClick} busy={busy}>
      {label}
    </MenuItem>
  );
}

function AppKitConnect({ label, variant }: { label: string; variant: ConnectStyle }) {
  const { open } = useAppKit();
  return <Trigger variant={variant} label={label} onClick={() => void open({ view: 'Connect' })} />;
}

function BrowserConnect({ label, variant }: { label: string; variant: ConnectStyle }) {
  const [open, setOpen] = useState(false);
  const connectors = useConnectors();
  const connect = useConnect();
  // EIP-6963 wallets announce themselves by name; the generic one is only a fallback.
  const named = connectors.filter((c) => c.id !== 'injected');
  const hasLegacyProvider = typeof window !== 'undefined' && 'ethereum' in window;
  const options = named.length > 0 ? named : hasLegacyProvider ? connectors : [];

  if (!open) {
    return (
      <>
        <Trigger
          variant={variant}
          label={label}
          busy={connect.isPending}
          onClick={() => (options.length === 1 ? connect.mutate({ connector: options[0]! }) : setOpen(true))}
        />
        {connect.error && <Notice tone="error">{walletErrorMessage(connect.error)}</Notice>}
      </>
    );
  }
  return (
    <>
      {options.length === 0 ? (
        <Notice>
          В браузере не найден кошелёк. Установите{' '}
          <ExternalLink href="https://metamask.io/download">MetaMask</ExternalLink>,{' '}
          <ExternalLink href="https://trustwallet.com/browser-extension">Trust Wallet</ExternalLink> или{' '}
          <ExternalLink href="https://phantom.com/download">Phantom</ExternalLink> и обновите страницу.
        </Notice>
      ) : (
        options.map((connector) => (
          <MenuItem
            key={connector.uid}
            busy={connect.isPending && connect.variables?.connector === connector}
            onClick={() => connect.mutate({ connector }, { onSuccess: () => setOpen(false) })}
          >
            {connector.icon && <img className="wallet-icon" src={connector.icon} alt="" width={22} height={22} />}
            {connector.id === 'injected' ? 'Кошелёк браузера' : connector.name}
          </MenuItem>
        ))
      )}
      {connect.error && <Notice tone="error">{walletErrorMessage(connect.error)}</Notice>}
      <MenuItem onClick={() => setOpen(false)}>Назад</MenuItem>
    </>
  );
}

/** Which wallet is connected — a quiet line under the menu. */
export function WalletLine() {
  const { address } = useConnection();
  if (!address) return null;
  return <p className="wallet-line">Кошелёк {shortAddress(address)}</p>;
}

/** Menu entry that disconnects the current wallet. */
export function DisconnectItem() {
  const disconnect = useDisconnect();
  return <MenuItem onClick={() => disconnect.mutate()}>Сменить кошелёк</MenuItem>;
}
