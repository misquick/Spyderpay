import pg from 'pg';
import { buildChainRegistry } from './config/chains.js';
import type { Env } from './config/env.js';
import { createApp } from './http/app.js';
import { EvmChainClients } from './infrastructure/blockchain/EvmChainClient.js';
import { createPgRepositories, PgUnitOfWork } from './infrastructure/db/PgUnitOfWork.js';
import { HttpWebhookSender } from './infrastructure/webhooks/HttpWebhookSender.js';
import { systemClock, type Logger } from './ports/system.js';
import { NATIVE } from './domain/invoice.js';
import { ConfirmationTracker } from './services/ConfirmationTracker.js';
import { InvoiceService } from './services/InvoiceService.js';
import { MerchantService } from './services/MerchantService.js';
import { PaymentScanner } from './services/PaymentScanner.js';
import { PaymentService } from './services/PaymentService.js';
import { Presenter } from './services/presenter.js';
import { WebhookDispatcher } from './services/WebhookDispatcher.js';
import { WebhookPublisher } from './services/WebhookPublisher.js';
import { Worker, type Job } from './worker/Worker.js';

/**
 * Composition root: the only place that knows concrete classes.
 * Everything else receives its dependencies through the constructor.
 */
export function createContainer(env: Env, logger: Logger) {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const chains = buildChainRegistry(env.chainIds, env.raw);
  const repos = createPgRepositories(pool);
  const uow = new PgUnitOfWork(pool);
  const clock = systemClock;

  const presenter = new Presenter(chains, env.PUBLIC_URL);
  const chainClients = new EvmChainClients(chains);
  const publisher = new WebhookPublisher(presenter, clock);
  const merchants = new MerchantService(repos.merchants);
  const invoices = new InvoiceService(repos.invoices, repos.merchants, chains, clock, env.INVOICE_TTL_MINUTES);
  const payments = new PaymentService(repos.invoices, chainClients);
  const dispatcher = new WebhookDispatcher(repos, new HttpWebhookSender(env.WEBHOOK_ALLOW_PRIVATE), clock, logger);

  const jobs: Job[] = chains.list().flatMap((chain) => {
    const client = chainClients.forChain(chain.id);
    const scanner = new PaymentScanner(chain, client, repos, uow, payments, publisher, logger, {
      // ETH transfers have no logs: blocks are read one by one, so smaller steps.
      blockRange: chain.token.address === NATIVE ? Math.min(env.SCAN_BLOCK_RANGE, 30) : env.SCAN_BLOCK_RANGE,
      maxBatches: 20,
    });
    const tracker = new ConfirmationTracker(chain, client, repos, uow, publisher, clock, logger);
    return [
      { name: `scan:${chain.id}`, run: () => scanner.run() },
      { name: `confirm:${chain.id}`, run: () => tracker.run() },
    ];
  });
  jobs.push({ name: 'webhooks', run: () => dispatcher.run() });

  const app = createApp({
    merchants,
    invoices,
    payments,
    presenter,
    chains,
    appName: env.APP_NAME,
    reownProjectId: env.REOWN_PROJECT_ID,
    staticDir: env.STATIC_DIR,
    registrationOpen: env.ALLOW_REGISTRATION,
    checkDatabase: async () => void (await pool.query('SELECT 1')),
    logger,
  });

  return { pool, app, worker: new Worker(jobs, env.WORKER_INTERVAL_MS, logger), chains };
}
