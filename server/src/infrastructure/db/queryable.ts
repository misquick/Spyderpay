import type { Pool, PoolClient, QueryResultRow } from 'pg';

/** Either the pool (auto-commit) or a client inside a transaction. */
export type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function queryOne<T extends QueryResultRow>(db: Queryable, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === '23505' &&
  (error as { constraint?: string }).constraint === constraint;
