import { createContext, useContext } from 'react';
import type { AppConfig, ChainInfo } from './api';

const ConfigContext = createContext<AppConfig | null>(null);

export const ConfigProvider = ConfigContext.Provider;

export function useAppConfig(): AppConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error('ConfigProvider is missing');
  return config;
}

export function useChain(chainId: number): ChainInfo | undefined {
  return useAppConfig().chains.find((c) => c.chainId === chainId);
}
