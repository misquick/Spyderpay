import { join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { ChainRegistry } from '../config/chains.js';
import type { Logger } from '../ports/system.js';
import type { InvoiceService } from '../services/InvoiceService.js';
import type { MerchantService } from '../services/MerchantService.js';
import type { PaymentService } from '../services/PaymentService.js';
import type { Presenter } from '../services/presenter.js';
import { errorHandler, limiter, notFoundHandler } from './middleware.js';
import { invoiceRoutes, merchantRoutes, publicRoutes } from './routes.js';

export interface HttpDependencies {
  merchants: MerchantService;
  invoices: InvoiceService;
  payments: PaymentService;
  presenter: Presenter;
  chains: ChainRegistry;
  appName: string;
  reownProjectId: string | null;
  /** Built web app to serve on the same origin (single-service deploys such as Render). */
  staticDir?: string;
  registrationOpen: boolean;
  checkDatabase: () => Promise<void>;
  logger: Logger;
}

/** Builds the Express app. Only wiring — all logic lives in services. */
export function createApp(deps: HttpDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Caddy
  // CSP is off because the wallet modal loads scripts and connects to WalletConnect relays;
  // popups stay allowed for wallets that open one.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', limiter(60_000, 600));

  app.get('/api/health', async (_req, res) => {
    await deps.checkDatabase();
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      appName: deps.appName,
      reownProjectId: deps.reownProjectId,
      registrationOpen: deps.registrationOpen,
      defaultChainId: deps.chains.default.id,
      chains: deps.chains.list().map((c) => deps.presenter.chain(c)),
    });
  });

  app.use('/api/merchants', merchantRoutes(deps.merchants, deps.presenter, deps.registrationOpen));
  app.use('/api/invoices', invoiceRoutes(deps.merchants, deps.invoices, deps.presenter));
  app.use('/api/public', publicRoutes(deps.invoices, deps.payments, deps.presenter));

  app.use('/api', notFoundHandler);

  if (deps.staticDir) {
    const dir = deps.staticDir;
    app.use('/assets', express.static(join(dir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(dir, { index: false }));
    // Single-page app: every other GET returns index.html and the browser router takes over.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.set('cache-control', 'no-cache').sendFile(join(dir, 'index.html'));
    });
  }
  app.use(errorHandler(deps.logger));
  return app;
}
