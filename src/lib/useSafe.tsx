// Hooks for Safe proposals: propose → owners sign → any owner executes. Every step asks for confirmation in a
// custom dialog that shows exactly what the transaction does (decoded in this browser, not by the API).
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import { signTypedData, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { activeChain } from '../config';
import { useDialog, useToast, explorer } from '../components/ui';
import { useWalletUI } from '../components/Wallet';
import { safeAbi } from './abis';
import { short } from './format';
import { buildSignatures, checkNewCall, readSafeInfo, verifyProposal, type Decoded, type Proposal, type SafeInfo } from './safe';
import { errorMessage, useAuthedApi, useTx } from './tx';
import { wagmiConfig } from './wagmi';

const lc = (x?: string | null) => (x || '').toLowerCase();

export function useSafeInfo() {
  return useQuery({ queryKey: ['safe-info'], queryFn: readSafeInfo, refetchInterval: 15_000, staleTime: 5_000 });
}

export function useProposals(view: 'queue' | 'history' = 'queue', enabled = true) {
  const authed = useAuthedApi();
  return useQuery({
    enabled,
    queryKey: ['proposals', view],
    queryFn: () => authed.get<{ safe: { address: string; nonce: number; threshold: number; owners: string[] } | null; proposals: Proposal[] }>('/admin/proposals', { view }),
    refetchInterval: view === 'queue' ? 12_000 : 30_000,
  });
}

const lines = (d: Decoded): [string, React.ReactNode][] => d.lines.map(([k, v, t]) => [k, t === 'address' ? <span className="mono" style={{ fontSize: 12.5 }}>{v}</span> : v]);

export interface NewCall { to: string; value?: bigint; data: Hex; label?: string; nonce?: number }

/** Propose / sign / execute / discard with dialogs and toasts. */
export function useSafeActions() {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const qc = useQueryClient();
  const { address } = useAccount();
  const { ensureReady } = useWalletUI();
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['proposals'] });
    qc.invalidateQueries({ queryKey: ['safe-info'] });
    qc.invalidateQueries({ queryKey: ['admin-safe'] });
    qc.invalidateQueries({ queryKey: ['admin-funds'] });
    qc.invalidateQueries({ queryKey: ['admin-overview'] });
  }, [qc]);

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
      return null;
    } finally {
      setBusy(null);
    }
  }, [toast]);

  /** Creates a proposal after showing the decoded call. */
  const propose = useCallback((call: NewCall, info: SafeInfo | undefined, extra?: { note?: string }) => run('propose', async () => {
    const d = checkNewCall(call.to, call.value ?? 0n, call.data, info);
    if (!info) return null;
    const ok = await dialog.confirm({
      title: 'Create a Safe proposal?',
      tone: d.tone === 'danger' ? 'danger' : d.tone === 'warning' ? 'warning' : 'default',
      message: (<><b style={{ color: 'var(--fg)' }}>{d.title}</b><span>Nothing happens yet. {info.threshold} of {info.owners.length} owners must sign, then any owner executes it.{extra?.note ? ` ${extra.note}` : ''}</span></>),
      details: lines(d),
      confirmLabel: 'Create proposal',
    });
    if (!ok) return null;
    const r = await authed.post<{ proposal: Proposal }>('/admin/proposals', {
      to: lc(call.to), value: String(call.value ?? 0n), data: call.data, label: call.label || d.title, ...(call.nonce !== undefined ? { nonce: call.nonce } : {}),
    });
    toast(`Proposal #${r.proposal.id} is waiting for signatures (nonce ${r.proposal.nonce}).`, 'success', { title: 'Proposal created' });
    refresh();
    return r.proposal;
  }), [authed, dialog, refresh, run, toast]);

  const sign = useCallback((p: Proposal, info: SafeInfo | undefined) => run(`sign-${p.id}`, async () => {
    if (!(await ensureReady()) || !address) return null;
    if (!info) throw new Error('Safe status is still loading.');
    if (!info.owners.includes(lc(address))) throw new Error(`Your wallet ${short(address)} is not an owner of the Safe.`);
    const { decoded: d, typed } = await verifyProposal(p, info);
    const ok = await dialog.confirm({
      title: 'Sign this proposal?',
      tone: d.tone === 'danger' ? 'danger' : d.tone === 'warning' ? 'warning' : 'default',
      message: (<><b style={{ color: 'var(--fg)' }}>{d.title}</b><span>Your wallet will show a "SafeTx" signature request. Signing costs no gas. Check that the Safe, the nonce and the data match.</span></>),
      details: [...lines(d), ['Safe', <span className="mono" style={{ fontSize: 12.5 }}>{info.safe}</span>], ['Nonce', String(p.nonce)], ['Transaction hash', <span className="mono" style={{ fontSize: 12 }}>{short(p.safe_tx_hash)}</span>]],
      confirmLabel: 'Sign in wallet',
    });
    if (!ok) return null;
    // Exactly the typed data verified above (local hash == stored hash == the Safe's own getTransactionHash).
    const signature = await signTypedData(wagmiConfig, { account: address, ...typed });
    await authed.post(`/admin/proposals/${p.id}/sign`, { signature });
    toast(`Signature added to proposal #${p.id}.`, 'success', { title: 'Signed' });
    refresh();
    return true;
  }), [address, authed, dialog, ensureReady, refresh, run, toast]);

  const execute = useCallback((p: Proposal, info: SafeInfo | undefined) => run(`exec-${p.id}`, async () => {
    if (!(await ensureReady()) || !address) return null;
    if (!info) throw new Error('Safe status is still loading.');
    const { decoded: d, typed } = await verifyProposal(p, info);
    if (Number(p.nonce) !== info.nonce) throw new Error(`The Safe is at nonce ${info.nonce}. Execute or remove the proposals before #${p.nonce} first.`);
    const { packed, count } = await buildSignatures(p, info, address);
    if (count < info.threshold) throw new Error(`Needs ${info.threshold - count} more owner signature(s) first.`);
    const selfApproves = info.owners.includes(lc(address)) && !p.signatures.some((s) => lc(s.signer) === lc(address));
    const ok = await dialog.confirm({
      title: 'Execute this transaction?',
      tone: d.tone === 'danger' ? 'danger' : 'warning',
      message: (<><b style={{ color: 'var(--fg)' }}>{d.title}</b><span>This sends the transaction from your wallet (you pay the gas){selfApproves ? ' and counts as your approval' : ''}. The Safe checks all signatures again on-chain.</span></>),
      details: [...lines(d), ['Signatures', `${count} of ${info.threshold} needed`], ['Nonce', String(p.nonce)]],
      confirmLabel: 'Execute',
    });
    if (!ok) return null;
    const { request } = await simulateContract(wagmiConfig, {
      address: info.safe as Address, abi: safeAbi, functionName: 'execTransaction', account: address, chainId: activeChain.id,
      args: [typed.message.to, typed.message.value, typed.message.data, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', packed],
    });
    const hash = await writeContract(wagmiConfig, request as any);
    toast('Waiting for the transaction to confirm…', 'info', { title: 'Sent', action: { label: 'View transaction', href: explorer('tx', hash) } });
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: activeChain.id, confirmations: 2 });
    if (receipt.status !== 'success') throw new Error('The transaction failed on-chain.');
    await authed.post(`/admin/proposals/${p.id}/executed`, { txHash: hash }).catch(() => undefined);
    toast(d.title, 'success', { title: 'Executed', action: { label: 'View transaction', href: explorer('tx', hash) } });
    refresh();
    qc.invalidateQueries();
    return hash;
  }), [address, authed, dialog, ensureReady, qc, refresh, run, toast]);

  const discard = useCallback((p: Proposal, laterCount: number) => run(`discard-${p.id}`, async () => {
    const ok = await dialog.confirm({
      title: `Remove proposal #${p.id} from the queue?`,
      tone: 'warning',
      message: (<><span>Nobody has signed it, so removing it is safe.</span>
        {laterCount > 0 && <span><b style={{ color: 'var(--fg)' }}>{laterCount} later proposal(s)</b> move up one nonce (only possible while they are unsigned too).</span>}</>),
      confirmLabel: 'Remove',
    });
    if (!ok) return null;
    await authed.post(`/admin/proposals/${p.id}/discard`, {});
    toast(`Proposal #${p.id} removed.`, 'success');
    refresh();
    return true;
  }), [authed, dialog, refresh, run, toast]);

  /** A no-op Safe transaction at the same nonce: once executed, the original can never run. */
  const reject = useCallback((p: Proposal, info: SafeInfo | undefined) => {
    if (!info?.safe) return Promise.resolve(null);
    return propose({ to: info.safe, value: 0n, data: '0x', nonce: Number(p.nonce), label: `Reject proposal #${p.id}` }, info, { note: `Executing it uses up nonce ${p.nonce}, so proposal #${p.id} can never run.` });
  }, [propose]);

  return { busy, propose, sign, execute, discard, reject };
}

/**
 * One owner-only action on a marketplace contract, routed by who owns it:
 * the Safe → a proposal; the connected wallet → a normal transaction; anyone else → copy the call data.
 */
export function useOwnerAction() {
  const { propose, busy: pBusy } = useSafeActions();
  const { run, busy: tBusy } = useTx();
  const { address } = useAccount();
  const toast = useToast();
  const info = useSafeInfo();
  const act = useCallback(async (p: { contract: string; owner?: string | null; abi: Abi; functionName: string; args?: readonly unknown[]; label: string }) => {
    const data = encodeFunctionData({ abi: p.abi, functionName: p.functionName, args: p.args } as any);
    const owner = lc(p.owner);
    if (info.data?.isSafe && owner === info.data.safe) return propose({ to: p.contract, data, label: p.label }, info.data);
    if (owner && owner === lc(address)) return run(p.label, { address: p.contract, abi: p.abi, functionName: p.functionName, args: p.args });
    await navigator.clipboard?.writeText(JSON.stringify({ to: p.contract, value: '0', data }, null, 2)).catch(() => undefined);
    toast(`Only the owner (${short(owner)}) can do this. The call data was copied.`, 'info', { title: 'Copied for the owner' });
    return null;
  }, [address, info.data, propose, run, toast]);
  return { act, busy: pBusy || tBusy, safe: info.data };
}
