/** An ERC-20 `Transfer` event as observed on chain. Addresses are lower-case. */
export interface TokenTransfer {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  blockTime: Date;
  token: string;
  from: string;
  to: string;
  value: bigint;
}
