import type { Server } from 'node:http';
import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { migrate } from './infrastructure/db/migrate.js';
import { createLogger } from './infrastructure/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const { pool, app, worker, chains } = createContainer(env, logger);

  await migrate(pool, logger);

  let server: Server | undefined;
  if (env.ROLE !== 'worker') {
    server = app.listen(env.PORT, () => logger.info('api listening', { port: env.PORT }));
  }
  if (env.ROLE !== 'api') worker.start();
  logger.info('chains enabled', { chains: chains.list().map((c) => `${c.name} (${c.id})`) });

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    server?.close();
    await worker.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
