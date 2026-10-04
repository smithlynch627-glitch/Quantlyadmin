import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useSignMessage } from 'wagmi';
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { PINNED, activeChain } from '../config';
import { useToast } from '../components/ui';
import { useWalletUI } from '../components/Wallet';
import { api, ApiError } from './api';
import { withSession } from './session';
import { wagmiConfig } from './wagmi';

export function errorMessage(e: unknown): string {
  const err = e as any;
  if (e instanceof ApiError) return e.message;
  const reverted = typeof err?.walk === 'function' ? err.walk((x: any) => x?.name === 'ContractFunctionRevertedError') : null;
  if (reverted?.data?.errorName) return `Reverted: ${reverted.data.errorName}`;
  const text = `${err?.shortMessage || ''} ${err?.message || ''}`;
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(text)) return 'You declined the request in your wallet.';
  return (err?.shortMessage || err?.message || 'Something went wrong').split('\n')[0].slice(0, 200);
}

/** Admin API calls with a wallet-signed session (the API re-checks the role on every call). */
export function useAuthedApi() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const call = async <T,>(fn: (tk: string) => Promise<T>): Promise<T> => {
    if (!address) throw new Error('Connect your wallet first');
    return withSession(address, (message) => signMessageAsync({ message }), fn);
  };
  return {
    get: <T,>(path: string, params?: Record<string, any>) => call((tk) => api.get<T>(path, params, tk)),
    post: <T,>(path: string, body?: unknown) => call((tk) => api.post<T>(path, body, tk)),
    put: <T,>(path: string, body: unknown) => call((tk) => api.put<T>(path, body, tk)),
    patch: <T,>(path: string, body: unknown) => call((tk) => api.patch<T>(path, body, tk)),
    del: <T,>(path: string) => call((tk) => api.del<T>(path, tk)),
    request: <T,>(method: string, path: string, body: unknown) => call((tk) => api.request<T>(method, path, body, tk)),
  };
}

/** Simulate → send → wait → sync, with toasts. */
export function useTx() {
  const toast = useToast();
  const qc = useQueryClient();
  const { address } = useAccount();
  const { ensureReady } = useWalletUI();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (label: string, params: any) => {
    if (!(await ensureReady()) || !address) return null;
    setBusy(label);
    try {
      // Only the pinned marketplace contracts, on the pinned chain (a tampered API can't redirect admin transactions).
      if (PINNED.contracts.length && !PINNED.contracts.includes(String(params.address).toLowerCase())) {
        throw new Error(`Security check: ${params.address} is not one of the marketplace contracts built into this admin site. Nothing was sent.`);
      }
      if (PINNED.chainId && activeChain.id !== PINNED.chainId) throw new Error(`Security check: the API reports chain ${activeChain.id}, this admin site is built for ${PINNED.chainId}. Nothing was sent.`);
      const { request } = await simulateContract(wagmiConfig, { ...params, account: address, chainId: activeChain.id });
      const hash = await writeContract(wagmiConfig, request as any);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: activeChain.id, confirmations: 2 });
      if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
      await api.post('/orders/sync', { txHash: hash }).catch(() => undefined);
      toast('Transaction confirmed');
      qc.invalidateQueries();
      return receipt;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return null;
    } finally {
      setBusy(null);
    }
  }, [address, ensureReady, qc, toast]);
  return { busy, run };
}
