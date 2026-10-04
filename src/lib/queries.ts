import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useAuthedApi } from './tx';

export type Role = 'owner' | 'admin' | 'support';
export const RANK: Record<Role, number> = { support: 1, admin: 2, owner: 3 };

export interface ChainInfo {
  ready: boolean; block: number; wrapped: string; guardian: string | null; marketVersion: number;
  market: { address: string; owner: string; paused: boolean; feeBps: number; feeRecipient: string };
  factory: { address: string; owner: string; paused: boolean; feeBps: number };
  factories: { address: string; owner: string | null; paused: boolean | null; feeBps: number | null; pendingOwner: string | null; current: boolean }[];
  vault: { address: string; owner: string; native: string; wrapped: string };
}
export interface Scan { startBlock: number; scannedTo: number; head: number | null; done: boolean; running: boolean; progress: number; error: string | null }
export interface Series { day: string; value: string; sales?: number }
export interface Overview {
  stats: Record<string, any>; tickets: { open: number; waiting: number }; daily: Series[]; proposals: { pending: number };
  network: { key: string; name: string; chainId: number; isTestnet: boolean; locked: boolean; status: any };
}
export interface TreasuryEvent { tx_hash: string; block: number; log_index: number; name: string; args: Record<string, any>; block_time: string | null }
export interface Funds {
  ready: boolean; wrapped: string; vault: { address: string; native: string; wrapped: string }; safe: { address: string; native: string; wrapped: string } | null;
  earnings: { mint_wei: string; trade_wei: string; last30_wei: string }; daily: Series[]; withdrawals: TreasuryEvent[]; scan: Scan;
}
export interface SafeHistoryItem { tx_hash: string; block: number; time: string | null; safe_tx_hash: string | null; success: boolean | null; to: string | null; value: string; data: string | null; nonce: number | null; executor: string | null; changes: { name: string; args: Record<string, any> }[] }
export interface Check { id: string; ok: boolean; level?: 'danger' | 'warning' | 'info'; title: string; detail: string }
export interface Managed { key: string; name: string; address: string; owner: string | null; pendingOwner: string | null; paused: boolean | null; ownedBySafe: boolean }
export interface SafeStatus {
  ready: boolean; owner?: string; guardian: string | null; managed: Managed[];
  safe: null | { address: string; owners: { address: string; panelRole: Role | null }[]; threshold: number; nonce: number; version: string; modules: string[] | null; guard: string | null; fallbackHandler: string | null; balances: { native: string; wrapped: string } };
  checks?: Check[]; history?: SafeHistoryItem[]; scan?: Scan;
}

export function useMe() {
  const { address } = useAccount();
  const authed = useAuthedApi();
  return useQuery({ queryKey: ['admin-me', address], queryFn: () => authed.get<{ role: Role }>('/admin/me'), enabled: !!address, retry: false });
}
export function useChainInfo() {
  const authed = useAuthedApi();
  return useQuery({ queryKey: ['admin-chain'], queryFn: () => authed.get<ChainInfo>('/admin/chain'), refetchInterval: 20_000 });
}
export function useOverview() {
  const authed = useAuthedApi();
  return useQuery({ queryKey: ['admin-overview'], queryFn: () => authed.get<Overview>('/admin/overview'), refetchInterval: 30_000 });
}
export function useFunds(enabled = true) {
  const authed = useAuthedApi();
  return useQuery({ queryKey: ['admin-funds'], queryFn: () => authed.get<Funds>('/admin/funds'), refetchInterval: 20_000, enabled });
}
export function useSafeStatus(enabled = true) {
  const authed = useAuthedApi();
  return useQuery({ queryKey: ['admin-safe'], queryFn: () => authed.get<SafeStatus>('/admin/safe'), refetchInterval: 20_000, enabled });
}
