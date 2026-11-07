import '@fontsource-variable/onest';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { WagmiProvider } from 'wagmi';
import { api } from './api';
import { router } from './App';
import { ConfigProvider } from './config';
import { setupWallet } from './wallet';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 2000 } },
});

/** Loads the server configuration (networks, tokens) first, then sets up wallets with it. */
async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const config = await api.config();
    document.title = config.appName;
    const wagmiConfig = setupWallet(config);
    root.render(
      <StrictMode>
        <ConfigProvider value={config}>
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </WagmiProvider>
        </ConfigProvider>
      </StrictMode>,
    );
  } catch {
    root.render(
      <main className="home">
        <h1 className="home-title">Сервис временно недоступен</h1>
        <p className="home-lead">Не удалось связаться с сервером. Обновите страницу через минуту.</p>
      </main>,
    );
  }
}

void bootstrap();
