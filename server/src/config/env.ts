import { z } from 'zod';

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** api = HTTP only, worker = background jobs only, all = both in one process. */
  ROLE: z.enum(['all', 'api', 'worker']).default('all'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Public address of the site, used to build payment links. */
  PUBLIC_URL: z.url().default('http://localhost:5173').transform((u) => u.replace(/\/+$/, '')),
  APP_NAME: z.string().min(1).default('SpyderPay'),
  /** Public Reown (WalletConnect) project id, handed to the browser via /api/config. */
  REOWN_PROJECT_ID: z.string().trim().optional().transform((v) => v || null),
  /** Folder with the built web app; when set, this server serves the site too (Render). */
  STATIC_DIR: z.string().optional(),

  /** Comma-separated chain ids. The first one is the default for new invoices. */
  CHAINS: z.string().default('84532,11155111'),
  ALLOW_REGISTRATION: flag(true),
  INVOICE_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),

  WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  /** Max block range per eth_getLogs call; public RPCs often allow 500–2000. */
  SCAN_BLOCK_RANGE: z.coerce.number().int().min(10).max(10_000).default(500),
  /** Allow webhooks to private/loopback addresses (only for local development). */
  WEBHOOK_ALLOW_PRIVATE: flag(false),
});

export type Env = z.infer<typeof schema> & {
  chainIds: number[];
  /** Raw environment, for per-chain overrides such as RPC_URL_84532. */
  raw: Record<string, string | undefined>;
};

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // On Render the public address is provided automatically.
  const withDefaults = { ...source, PUBLIC_URL: source.PUBLIC_URL || source.RENDER_EXTERNAL_URL || undefined };
  const parsed = schema.safeParse(withDefaults);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  const chainIds = parsed.data.CHAINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (chainIds.length === 0 || chainIds.some((id) => !Number.isInteger(id))) {
    throw new Error('CHAINS must be a comma-separated list of chain ids, e.g. "84532,11155111"');
  }
  return { ...parsed.data, chainIds, raw: source };
}
