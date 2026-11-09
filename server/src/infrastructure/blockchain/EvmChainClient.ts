import {
  createPublicClient,
  erc20Abi,
  http,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type PublicClient,
} from 'viem';
import type { ChainConfig, ChainRegistry } from '../../config/chains.js';
import { NATIVE } from '../../domain/invoice.js';
import type { TokenTransfer } from '../../domain/transfer.js';
import type { BlockRef, ChainClient, ChainClients, TransferQuery, TxInspection } from '../../ports/blockchain.js';

const transferEvent = erc20Abi.find((item) => item.type === 'event' && item.name === 'Transfer')!;

/** ChainClient for any EVM network, backed by viem and a JSON-RPC endpoint. */
export class EvmChainClient implements ChainClient {
  private readonly client: PublicClient;
  private readonly blockTimes = new Map<bigint, BlockRef>();

  constructor(private readonly chain: ChainConfig) {
    this.client = createPublicClient({
      chain: chain.viem,
      transport: http(chain.rpcUrl, { retryCount: 2, timeout: 15_000 }),
    });
  }

  async getHead(): Promise<BlockRef> {
    const block = await this.client.getBlock({ blockTag: 'latest' });
    return { number: block.number, time: toDate(block.timestamp) };
  }

  async getBlock(number: bigint): Promise<BlockRef> {
    const cached = this.blockTimes.get(number);
    if (cached) return cached;
    const block = await this.client.getBlock({ blockNumber: number });
    const ref = { number: block.number, time: toDate(block.timestamp) };
    if (this.blockTimes.size > 1000) this.blockTimes.clear();
    this.blockTimes.set(number, ref);
    return ref;
  }

  async inspectTransaction(txHash: string): Promise<TxInspection> {
    let receipt;
    try {
      receipt = await this.client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return { status: 'not_found' };
      throw error;
    }
    if (receipt.status !== 'success') return { status: 'reverted' };

    const { time } = await this.getBlock(receipt.blockNumber);
    const logs = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs });
    const transfers: TokenTransfer[] = [];

    // A plain ETH transfer: the value travels on the transaction itself, not in a log.
    if (this.chain.token.address === NATIVE) {
      const tx = await this.client.getTransaction({ hash: txHash as `0x${string}` });
      if (tx.to && tx.value > 0n) {
        transfers.push({
          chainId: this.chain.id,
          txHash: receipt.transactionHash.toLowerCase(),
          logIndex: -1,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash.toLowerCase(),
          blockTime: time,
          token: NATIVE,
          from: tx.from.toLowerCase(),
          to: tx.to.toLowerCase(),
          value: tx.value,
        });
      }
    }

    return {
      status: 'success',
      transfers: transfers.concat(logs.map((log) => ({
        chainId: this.chain.id,
        txHash: receipt.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash.toLowerCase(),
        blockTime: time,
        token: log.address.toLowerCase(),
        from: log.args.from.toLowerCase(),
        to: log.args.to.toLowerCase(),
        value: log.args.value,
      }))),
    };
  }

  private async findNativeTransfers(query: TransferQuery): Promise<TokenTransfer[]> {
    const recipients = new Set(query.recipients);
    const transfers: TokenTransfer[] = [];
    for (const block of await readBlocks(this.client, query.fromBlock, query.toBlock)) {
      const time = toDate(block.timestamp);
      this.blockTimes.set(block.number, { number: block.number, time });
      for (const tx of block.transactions) {
        const to = tx.to?.toLowerCase();
        if (!to || !recipients.has(to) || tx.value === 0n) continue;
        // Only successful transactions count; the receipt tells us.
        const receipt = await this.client.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status !== 'success') continue;
        transfers.push({
          chainId: this.chain.id,
          txHash: tx.hash.toLowerCase(),
          logIndex: -1,
          blockNumber: block.number,
          blockHash: block.hash.toLowerCase(),
          blockTime: time,
          token: NATIVE,
          from: tx.from.toLowerCase(),
          to,
          value: tx.value,
        });
      }
    }
    return transfers;
  }

  async findTransfers(query: TransferQuery): Promise<TokenTransfer[]> {
    if (query.recipients.length === 0) return [];
    if (query.token === NATIVE) return this.findNativeTransfers(query);
    const logs = await this.client.getLogs({
      address: query.token as `0x${string}`,
      event: transferEvent,
      args: { to: query.recipients as `0x${string}`[] },
      fromBlock: query.fromBlock,
      toBlock: query.toBlock,
      strict: true,
    });
    const transfers: TokenTransfer[] = [];
    for (const log of logs) {
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.logIndex === null) {
        continue; // pending log — will be picked up once mined
      }
      const { time } = await this.getBlock(log.blockNumber);
      transfers.push({
        chainId: this.chain.id,
        txHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash.toLowerCase(),
        blockTime: time,
        token: log.address.toLowerCase(),
        from: log.args.from.toLowerCase(),
        to: log.args.to.toLowerCase(),
        value: log.args.value,
      });
    }
    return transfers;
  }
}

/** ETH transfers leave no logs, so blocks are read with their transactions, a few at a time. */
async function readBlocks(client: PublicClient, from: bigint, to: bigint) {
  const numbers: bigint[] = [];
  for (let n = from; n <= to; n++) numbers.push(n);
  const blocks = [];
  for (let i = 0; i < numbers.length; i += 6) {
    const chunk = numbers.slice(i, i + 6);
    blocks.push(...(await Promise.all(chunk.map((blockNumber) => client.getBlock({ blockNumber, includeTransactions: true })))));
  }
  return blocks;
}

/** One client per enabled chain, created lazily. */
export class EvmChainClients implements ChainClients {
  private readonly clients = new Map<number, ChainClient>();

  constructor(private readonly chains: ChainRegistry) {}

  forChain(chainId: number): ChainClient {
    let client = this.clients.get(chainId);
    if (!client) {
      client = new EvmChainClient(this.chains.get(chainId));
      this.clients.set(chainId, client);
    }
    return client;
  }
}

const toDate = (seconds: bigint): Date => new Date(Number(seconds) * 1000);
