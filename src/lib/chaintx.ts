// Sending a transaction on QMS and waiting for it (same rules as the website, see frontend/src/lib/chaintx.ts).
// QMS's base fee can jump a lot within a day; a wallet that sets the max fee to the price of the moment then leaves
// the transaction stuck. The admin site suggests a fee with room for the base fee to triple (only the block's real
// base fee plus the tip is charged), and explains a long wait instead of spinning.
import { encodeFunctionData, type Address, type Hash, type Hex, type TransactionReceipt } from 'viem';
import { getPublicClient, waitForTransactionReceipt } from 'wagmi/actions';
import { activeChain } from '../config';
import { wagmiConfig } from './wagmi';

const BASE_FEE_ROOM = 3n;
const MIN_TIP = 1_000_000n;
const MAX_TIP = 5_000_000_000n;
const CONFIRMATIONS = 2;
const WAIT_LIMIT_MS = 20 * 60_000;

const client = () => getPublicClient(wagmiConfig, { chainId: activeChain.id });

export async function suggestFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined> {
  const c = client();
  if (!c) return undefined;
  try {
    const [block, tip] = await Promise.all([c.getBlock({ blockTag: 'latest' }), c.estimateMaxPriorityFeePerGas().catch(() => 0n)]);
    if (block.baseFeePerGas == null) return undefined;
    const priority = tip < MIN_TIP ? MIN_TIP : tip > MAX_TIP ? MAX_TIP : tip;
    return { maxFeePerGas: block.baseFeePerGas * BASE_FEE_ROOM + priority, maxPriorityFeePerGas: priority };
  } catch {
    return undefined;
  }
}

const SLOW: Record<'fee' | 'queued' | 'unknown', string> = {
  fee: 'Your wallet set a fee below what QMS needs right now. Open your wallet and choose Speed up on the pending transaction. Do not send it again.',
  queued: 'An older transaction from your wallet is still pending, and this one waits behind it. Speed up or cancel the older one in your wallet.',
  unknown: 'The QMS network has not received this transaction yet. Check your wallet: speed it up if it is pending there, or try again if it is not.',
};

async function whyPending(hash: Hash, from: Address): Promise<keyof typeof SLOW | null> {
  const c = client();
  if (!c) return null;
  const tx = await c.getTransaction({ hash }).catch(() => null);
  if (!tx) return 'unknown';
  if (tx.blockNumber != null) return null;
  const [next, block] = await Promise.all([c.getTransactionCount({ address: from, blockTag: 'latest' }), c.getBlock({ blockTag: 'latest' })]);
  if (tx.nonce > next) return 'queued';
  if (tx.nonce < next) return null;
  const cap = tx.maxFeePerGas ?? tx.gasPrice;
  return cap != null && block.baseFeePerGas != null && cap < block.baseFeePerGas ? 'fee' : null;
}

/** What was sent: a replacement (speed-up) only counts if it makes the same call. */
export type SentCall = { to: Address; input: Hex };
export function callOf(request: any): SentCall | undefined {
  try {
    return { to: request.address, input: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }) };
  } catch {
    return undefined;
  }
}

const REPLACED = 'This transaction was cancelled or replaced in your wallet, so nothing was done.';

/**
 * Waits for 2 blocks and success. `onSlow` gets a message (once per reason) when the transaction is stuck.
 * A speed-up (same call) counts; a cancel or any other replacement is an error (checked against `sent`, because
 * viem does not always report a replacement when it waits for more than one block).
 */
export async function waitMined(hash: Hash, from: Address, sent?: SentCall, onSlow?: (message: string) => void): Promise<TransactionReceipt> {
  let finished = false;
  let replaced: string | undefined;
  let told: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    const why = await whyPending(hash, from).catch(() => null);
    if (finished) return;
    if (why && why !== told) { told = why; onSlow?.(SLOW[why]); }
    timer = setTimeout(check, 30_000);
  };
  timer = setTimeout(check, 40_000);
  try {
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash, chainId: activeChain.id, confirmations: CONFIRMATIONS, timeout: WAIT_LIMIT_MS,
      onReplaced: (r) => { replaced = r.reason; },
    });
    if (replaced && replaced !== 'repriced') throw new Error(REPLACED);
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
      const landed = await client()?.getTransaction({ hash: receipt.transactionHash }).catch(() => null);
      const same = !!landed && !!sent && landed.to?.toLowerCase() === sent.to.toLowerCase() && landed.input.toLowerCase() === sent.input.toLowerCase();
      if (!same) throw new Error(REPLACED);
    }
    if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
    return receipt;
  } catch (e: any) {
    if (e?.name === 'WaitForTransactionReceiptTimeoutError') {
      throw new Error('Still not confirmed after 20 minutes. Check the transaction in your wallet or on QMSScan before you try again, so it is not sent twice.');
    }
    throw e;
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}
