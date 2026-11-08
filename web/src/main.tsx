import '@fontsource/forum';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-sc/500.css';
import '@fontsource/cormorant-sc/600.css';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { WagmiProvider } from 'wagmi';
import { api } from './api';
import { router } from './App';
import { ConfigProvider } from './config';
import { Decor } from './decor';
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
              <Decor />
              <RouterProvider router={router} />
            </QueryClientProvider>
          </WagmiProvider>
        </ConfigProvider>
      </StrictMode>,
    );
  } catch {
    root.render(
      <>
        <Decor />
        <main className="screen panel-screen">
          <header className="title-block">
            <h1 className="title glow">Сервис временно недоступен</h1>
            <p className="subtitle">Не удалось связаться с сервером. Обновите страницу через минуту.</p>
          </header>
        </main>
      </>,
    );
  }
}

void bootstrap();
