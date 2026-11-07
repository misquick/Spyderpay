import type { TokenTransfer } from '../domain/transfer.js';

/**
 * Blockchain access, split into small interfaces (Interface Segregation):
 * each service depends only on the capability it actually uses.
 */

export interface BlockRef {
  number: bigint;
  time: Date;
}

export type TxInspection =
  | { status: 'not_found' }
  | { status: 'reverted' }
  | { status: 'success'; transfers: TokenTransfer[] };

export interface TransactionInspector {
  /** Reads the receipt of a transaction and decodes all ERC-20 transfers in it. */
  inspectTransaction(txHash: string): Promise<TxInspection>;
}

export interface BlockReader {
  getHead(): Promise<BlockRef>;
  getBlock(number: bigint): Promise<BlockRef>;
}

export interface TransferQuery {
  token: string;
  recipients: string[];
  fromBlock: bigint;
  toBlock: bigint;
}

export interface TransferFinder {
  /** All transfers of `token` to any of `recipients` in the inclusive block range. */
  findTransfers(query: TransferQuery): Promise<TokenTransfer[]>;
}

export interface ChainClient extends TransactionInspector, BlockReader, TransferFinder {}

export interface ChainClients {
  forChain(chainId: number): ChainClient;
}
