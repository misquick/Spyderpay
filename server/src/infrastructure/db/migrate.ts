import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { Logger } from '../../ports/system.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const LOCK_ID = 727_274_001;

/** Applies `migrations/*.sql` in name order, each exactly once. Safe to run from several processes. */
export async function migrate(pool: Pool, logger: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('migration applied', { file });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
