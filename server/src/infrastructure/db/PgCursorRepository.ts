import type { BlockRef } from '../../ports/blockchain.js';
import type { CursorRepository } from '../../ports/repositories.js';
import { queryOne, type Queryable } from './queryable.js';

export class PgCursorRepository implements CursorRepository {
  constructor(private readonly db: Queryable) {}

  async get(chainId: number): Promise<BlockRef | null> {
    const row = await queryOne<{ block_number: string; block_time: Date }>(
      this.db,
      'SELECT block_number, block_time FROM chain_cursors WHERE chain_id = $1',
      [chainId],
    );
    return row && { number: BigInt(row.block_number), time: row.block_time };
  }

  async save(chainId: number, block: BlockRef): Promise<void> {
    await this.db.query(
      `INSERT INTO chain_cursors (chain_id, block_number, block_time) VALUES ($1, $2, $3)
       ON CONFLICT (chain_id) DO UPDATE SET block_number = $2, block_time = $3, updated_at = now()`,
      [chainId, block.number.toString(), block.time],
    );
  }

  async rewind(chainId: number, block: BlockRef): Promise<void> {
    await this.db.query(
      `UPDATE chain_cursors SET block_number = $2, block_time = $3, updated_at = now()
       WHERE chain_id = $1 AND block_number > $2`,
      [chainId, block.number.toString(), block.time],
    );
  }
}
