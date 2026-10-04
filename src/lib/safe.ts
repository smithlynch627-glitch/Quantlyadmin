// Safe (multisig) logic that runs in the owner's browser. Nothing here trusts the API:
//  - signing only works when the build pins the chain, RPC, marketplace and Safe (Netlify env), see pinsProblem()
//  - the Safe address is read from the chain (owner() of the pinned marketplace) and must equal VITE_SAFE_ADDRESS
//  - every proposal is decoded locally against the pinned marketplace contracts, re-encoded and compared byte for byte;
//    unknown or non-standard calls are never signed or executed
//  - the SafeTx hash is computed locally AND read from the Safe itself; both must equal the proposal's hash, and the
//    wallet signs exactly that verified typed data (so it shows target, data and nonce, never a blind hash)
import { decodeFunctionData, encodeFunctionData, formatUnits, hashTypedData, recoverAddress, zeroAddress, type Address, type Hex } from 'viem';
import { readContract } from 'wagmi/actions';
import { NATIVE, PINNED, WRAPPED, activeChain, pinnedContracts } from '../config';
import { factoryAdminAbi, marketAdminAbi, safeAbi, vaultAdminAbi, wrappedAbi } from './abis';
import { wagmiConfig } from './wagmi';

export interface Signature { signer: string; signature: string; created_at: string }
export interface Proposal {
  id: number; safe: string; to_address: string; value_wei: string; data: string; nonce: number | string; safe_tx_hash: string;
  kind: string; label: string; status: 'pending' | 'executed' | 'failed' | 'replaced' | 'discarded';
  created_by: string; created_at: string; executed_tx: string | null; executed_by: string | null; executed_at: string | null;
  signatures: Signature[];
}
export interface SafeInfo { owner: string; isSafe: boolean; safe: string | null; owners: string[]; threshold: number; nonce: number; mismatch: boolean }
export interface Ctx { market: string; vault: string; factories: string[]; wrapped: string; safe: string | null; ownerCount: number | null }
export type Line = [string, string, ('address' | 'text')?];
export interface Decoded { known: boolean; fn: string; title: string; lines: Line[]; tone: 'danger' | 'warning' | 'neutral'; kind: string }

export const SENTINEL = '0x0000000000000000000000000000000000000001';
export const SAFE_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
  ],
} as const;

const lc = (x?: string | null) => (x || '').toLowerCase();
/** Rounded, for tiles and lists. */
export const coinText = (wei: bigint | string) => {
  const n = Number(formatUnits(BigInt(wei), 18));
  return n === 0 ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 });
};
/** Exact, for anything that is signed or executed. */
const exact = (wei: bigint | string) => formatUnits(BigInt(wei), 18);
const pctText = (bps: bigint | number) => `${Number(bps) / 100}%`;

/** Why signing is disabled on this build, or null when every pin is in place. */
export function pinsProblem(): string | null {
  const missing = [
    !PINNED.market && 'VITE_MARKET_ADDRESS', !PINNED.chainId && 'VITE_CHAIN_ID', !PINNED.rpc && 'VITE_RPC_URL', !PINNED.safe && 'VITE_SAFE_ADDRESS',
  ].filter(Boolean);
  if (missing.length) return `Signing is off on this build: set ${missing.join(', ')} in the admin site's Netlify environment, then redeploy.`;
  if (activeChain.id !== PINNED.chainId) return `Signing is off: the API reports chain ${activeChain.id}, but this admin site is built for chain ${PINNED.chainId}.`;
  return null;
}
function assertPinned() {
  const p = pinsProblem();
  if (p) throw new Error(p);
}

export function ctxFor(safe: string | null, ownerCount: number | null = null): Ctx {
  const c = pinnedContracts();
  return { market: lc(c.market), vault: lc(c.vault), factories: c.factories.map(lc), wrapped: lc(c.wrapped), safe: safe ? lc(safe) : null, ownerCount };
}

/** Reads who owns the pinned marketplace and, when it is a Safe, its owners, threshold and nonce. */
export async function readSafeInfo(): Promise<SafeInfo> {
  const { market } = pinnedContracts();
  const chainId = activeChain.id;
  const owner = lc((await readContract(wagmiConfig, { address: market, abi: marketAdminAbi, functionName: 'owner', chainId })) as string);
  try {
    const [owners, threshold, nonce] = (await Promise.all([
      readContract(wagmiConfig, { address: owner as Address, abi: safeAbi, functionName: 'getOwners', chainId }),
      readContract(wagmiConfig, { address: owner as Address, abi: safeAbi, functionName: 'getThreshold', chainId }),
      readContract(wagmiConfig, { address: owner as Address, abi: safeAbi, functionName: 'nonce', chainId }),
    ])) as [string[], bigint, bigint];
    return { owner, isSafe: true, safe: owner, owners: owners.map(lc), threshold: Number(threshold), nonce: Number(nonce), mismatch: !!PINNED.safe && PINNED.safe !== owner };
  } catch {
    return { owner, isSafe: false, safe: null, owners: [], threshold: 0, nonce: 0, mismatch: false };
  }
}

/** Human description of a Safe call. `known: false` means the panel will not sign or execute it. */
export function decodeCall(to: string, value: bigint | string, data: string, ctx: Ctx, names: Record<string, string> = {}): Decoded {
  const t = lc(to);
  const v = BigInt(value || 0);
  const d = lc(data || '0x') as Hex;
  const who = (x: string) => (lc(x) === ctx.safe ? 'the Safe' : names[lc(x)] || lc(x));
  const unknown: Decoded = { known: false, fn: 'unknown', title: 'Unknown call: not signed by this panel', lines: [['Contract', t, 'address'], ['Data', d.slice(0, 74) + (d.length > 74 ? '…' : '')]], tone: 'danger', kind: 'other' };
  const known = [ctx.market, ctx.vault, ctx.wrapped, ...ctx.factories];
  if (d === '0x') {
    if (ctx.safe && t === ctx.safe && v === 0n) return { known: true, fn: 'cancel', title: 'Cancel: uses up this nonce and does nothing', lines: [], tone: 'neutral', kind: 'cancel' };
    if (v > 0n && t !== ctx.safe && t !== zeroAddress && t !== SENTINEL && !known.includes(t)) {
      return { known: true, fn: 'transfer', title: `Send ${exact(v)} ${NATIVE} from the Safe`, lines: [['To', t, 'address'], ['Amount', `${exact(v)} ${NATIVE}`]], tone: 'warning', kind: 'transfer' };
    }
    return unknown;
  }
  if (v !== 0n) return unknown;
  const role = t === ctx.market ? 'market' : t === ctx.vault ? 'vault' : t === ctx.wrapped ? 'wrapped' : ctx.safe && t === ctx.safe ? 'safe' : ctx.factories.includes(t) ? 'factory' : null;
  const abi = role === 'market' ? marketAdminAbi : role === 'vault' ? vaultAdminAbi : role === 'wrapped' ? wrappedAbi : role === 'safe' ? safeAbi : role === 'factory' ? factoryAdminAbi : null;
  if (!abi) return unknown;
  let call: { functionName: string; args?: readonly unknown[] };
  try {
    call = decodeFunctionData({ abi: abi as any, data: d }) as any;
    // Re-encode and compare: trailing bytes or odd encodings can never hide anything.
    if (lc(encodeFunctionData({ abi: abi as any, functionName: call.functionName, args: call.args } as any)) !== d) return unknown;
  } catch {
    return unknown;
  }
  const args = (call.args || []) as any[];
  const f = call.functionName;
  if (args.some((a) => typeof a === 'string' && lc(a) === zeroAddress) && f !== 'setGuardian') return unknown;
  const factoryName = ctx.factories.length > 1 ? `Launchpad factory ${ctx.factories.indexOf(t) + 1}` : 'Launchpad factory';
  const where = role === 'market' ? 'Marketplace' : role === 'vault' ? 'FeeVault' : role === 'factory' ? factoryName : role === 'wrapped' ? WRAPPED : 'Safe';
  const base = (title: string, lines: Line[] = [], tone: Decoded['tone'] = 'neutral', kind = 'other'): Decoded => ({ known: true, fn: f, title, lines: [['Contract', `${where}`], ...lines], tone, kind });
  const n = ctx.ownerCount;
  const thOk = (x: unknown, max: number) => n !== null && Number(x) >= 2 && Number(x) <= max;
  const pinnedFactory = (x: string) => ctx.factories.includes(lc(x));
  switch (`${role}.${f}`) {
    case 'market.setMarketFeeBps': return base(`Set the trading fee to ${pctText(args[0])}`, [], 'neutral', 'fees');
    case 'market.setFeeRecipient': return base('Send future trading fees to a new address', [['New fee recipient', who(args[0]), 'address']], 'danger', 'fees');
    case 'market.setCollectionApproval': return base(`${args[1] ? 'Enable' : 'Disable'} trading for an imported collection`, [['Collection', who(args[0]), 'address']], 'neutral', 'collection');
    case 'market.setCollectionBlocked': return base(`${args[1] ? 'Block' : 'Unblock'} trading of a collection`, [['Collection', who(args[0]), 'address']], args[1] ? 'warning' : 'neutral', 'collection');
    case 'market.setFactory':
      return base(`${args[1] ? 'Accept' : 'Stop accepting'} a launchpad factory`, [['Factory', who(args[0]), 'address'], ...(args[1] && !pinnedFactory(args[0]) ? [['Warning', 'Not a factory built into this admin site'] as Line] : [])], args[1] && !pinnedFactory(args[0]) ? 'danger' : 'warning', 'factory');
    case 'market.setGuardian': return base(lc(args[0]) === zeroAddress ? 'Remove the emergency pause wallet' : 'Set the emergency pause wallet', lc(args[0]) === zeroAddress ? [] : [['Pause wallet', who(args[0]), 'address']], 'warning', 'guardian');
    case 'market.pause': return base('Pause trading (buys, offers, batch sends)', [], 'warning', 'pause');
    case 'market.unpause': return base('Resume trading', [], 'neutral', 'pause');
    case 'market.acceptOwnership': case 'vault.acceptOwnership': case 'factory.acceptOwnership': return base(`Accept ownership of the ${where}`, [], 'neutral', 'ownership');
    case 'factory.setPlatformFeeBps': return base(`Set the mint fee to ${pctText(args[0])}`, [], 'neutral', 'fees');
    case 'factory.pause': return base('Pause new collection launches', [], 'warning', 'pause');
    case 'factory.unpause': return base('Resume collection launches', [], 'neutral', 'pause');
    case 'vault.withdrawAllNative': return base(`Withdraw all ${NATIVE} from the FeeVault`, [['To', who(args[0]), 'address']], lc(args[0]) === ctx.safe ? 'neutral' : 'warning', 'withdraw');
    case 'vault.withdrawNative': return base(`Withdraw ${exact(args[1])} ${NATIVE} from the FeeVault`, [['To', who(args[0]), 'address'], ['Amount', `${exact(args[1])} ${NATIVE}`]], lc(args[0]) === ctx.safe ? 'neutral' : 'warning', 'withdraw');
    case 'vault.withdrawToken':
      if (lc(args[0]) !== ctx.wrapped) return unknown;
      return base(`Withdraw ${exact(args[2])} ${WRAPPED} from the FeeVault`, [['To', who(args[1]), 'address'], ['Amount', `${exact(args[2])} ${WRAPPED}`]], lc(args[1]) === ctx.safe ? 'neutral' : 'warning', 'withdraw');
    case 'vault.setFactory':
      return base(`${args[1] ? 'Allow' : 'Remove'} a factory in the FeeVault`, [['Factory', who(args[0]), 'address'], ...(args[1] && !pinnedFactory(args[0]) ? [['Warning', 'Not a factory built into this admin site'] as Line] : [])], args[1] && !pinnedFactory(args[0]) ? 'danger' : 'warning', 'factory');
    case 'wrapped.transfer': return base(`Send ${exact(args[1])} ${WRAPPED} from the Safe`, [['To', who(args[0]), 'address'], ['Amount', `${exact(args[1])} ${WRAPPED}`]], 'warning', 'transfer');
    case 'wrapped.withdraw': return base(`Unwrap ${exact(args[0])} ${WRAPPED} into ${NATIVE} (stays in the Safe)`, [], 'neutral', 'transfer');
    case 'safe.addOwnerWithThreshold':
      if (!thOk(args[1], (n ?? 0) + 1)) return unknown;
      return base('Add a Safe owner', [['New owner', lc(args[0]), 'address'], ['Signatures needed after', `${args[1]} of ${(n ?? 0) + 1}`]], 'danger', 'owners');
    case 'safe.removeOwner':
      if (!thOk(args[2], (n ?? 0) - 1)) return unknown;
      return base('Remove a Safe owner', [['Owner removed', lc(args[1]), 'address'], ['Signatures needed after', `${args[2]} of ${(n ?? 0) - 1}`]], 'danger', 'owners');
    case 'safe.swapOwner':
      if (n === null || [ctx.safe, SENTINEL].includes(lc(args[2]))) return unknown;
      return base('Replace a Safe owner', [['Old owner (removed)', lc(args[1]), 'address'], ['New owner', lc(args[2]), 'address']], 'danger', 'owners');
    case 'safe.changeThreshold':
      if (!thOk(args[0], n ?? 0)) return unknown;
      return base(`Require ${args[0]} of ${n} signatures`, [], 'danger', 'owners');
    default: return unknown;
  }
}

const message = (p: Pick<Proposal, 'to_address' | 'value_wei' | 'data' | 'nonce'>) => ({
  to: p.to_address as Address, value: BigInt(p.value_wei), data: p.data as Hex, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n,
  gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: BigInt(p.nonce),
});

export const typedData = (safe: string, p: Pick<Proposal, 'to_address' | 'value_wei' | 'data' | 'nonce'>) => ({
  domain: { chainId: activeChain.id, verifyingContract: safe as Address },
  types: SAFE_TYPES,
  primaryType: 'SafeTx' as const,
  message: message(p),
});
export type SafeTypedData = ReturnType<typeof typedData>;

/** Throws unless a new proposal would be allowed; returns the decoded call. */
export function checkNewCall(to: string, value: bigint, data: string, info: SafeInfo | undefined): Decoded {
  assertPinned();
  if (!info?.isSafe || !info.safe) throw new Error('The marketplace is not owned by a Safe.');
  if (info.mismatch) throw new Error(`Security check: the marketplace owner ${info.safe} is not the Safe built into this admin site (${PINNED.safe}).`);
  const d = decodeCall(to, value, data, ctxFor(info.safe, info.owners.length));
  if (!d.known) throw new Error('This panel can only propose the listed actions on the marketplace contracts.');
  return d;
}

/** All checks before signing or executing. Returns the decoded call and the exact typed data that was verified. */
export async function verifyProposal(p: Proposal, info: SafeInfo, names: Record<string, string> = {}): Promise<{ decoded: Decoded; typed: SafeTypedData }> {
  assertPinned();
  if (!info.isSafe || !info.safe) throw new Error('The marketplace is not owned by a Safe.');
  if (info.mismatch) throw new Error(`Security check: the marketplace owner ${info.safe} is not the Safe built into this admin site (${PINNED.safe}). Nothing was signed.`);
  if (lc(p.safe) !== info.safe) throw new Error('This proposal is for a different Safe than the one that owns the marketplace.');
  const decoded = decodeCall(p.to_address, p.value_wei, p.data, ctxFor(info.safe, info.owners.length), names);
  if (!decoded.known) throw new Error('This panel does not recognise the call in this proposal, so it will not sign or execute it.');
  const typed = typedData(info.safe, p);
  const local = lc(hashTypedData(typed));
  if (local !== lc(p.safe_tx_hash)) throw new Error('Security check: the proposal hash does not match its contents. Nothing was signed.');
  const onchain = lc((await readContract(wagmiConfig, {
    address: info.safe as Address, abi: safeAbi, functionName: 'getTransactionHash', chainId: activeChain.id,
    args: [typed.message.to, typed.message.value, typed.message.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, typed.message.nonce],
  })) as string);
  if (onchain !== local) throw new Error('Security check: the Safe computes a different hash for this proposal. Nothing was signed.');
  return { decoded, typed };
}

/** Owners whose stored signature really recovers to them for this proposal's hash (65-byte ECDSA, v = 27/28). */
export async function validSigners(p: Proposal, owners: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const set = new Set(owners.map(lc));
  for (const s of p.signatures) {
    const signer = lc(s.signer);
    const sig = lc(s.signature);
    if (!set.has(signer) || out.has(signer) || !/^0x[0-9a-f]{130}$/.test(sig)) continue;
    const v = parseInt(sig.slice(-2), 16);
    if (v !== 27 && v !== 28) continue;
    try {
      if (lc(await recoverAddress({ hash: p.safe_tx_hash as Hex, signature: sig as Hex })) === signer) out.set(signer, sig);
    } catch {}
  }
  return out;
}

/**
 * Signatures for execTransaction, ordered by owner address (the Safe requires ascending order), one per owner.
 * If the executing wallet is an owner that has not signed, it approves by sending the transaction itself
 * (Safe "approved by sender" signature: r = owner, s = 0, v = 1), so the last owner does not need a separate signature.
 */
export async function buildSignatures(p: Proposal, info: SafeInfo, executor?: string | null): Promise<{ packed: Hex; count: number }> {
  const valid = [...(await validSigners(p, info.owners)).entries()].map(([signer, sig]) => ({ signer, sig: sig.slice(2) }));
  const ex = lc(executor);
  if (ex && info.owners.includes(ex) && !valid.some((v) => v.signer === ex) && valid.length < info.threshold) {
    valid.push({ signer: ex, sig: `${'0'.repeat(24)}${ex.slice(2)}${'0'.repeat(64)}01` });
  }
  valid.sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  return { packed: `0x${valid.map((v) => v.sig).join('')}` as Hex, count: valid.length };
}

/** prevOwner for removeOwner / swapOwner (the Safe keeps owners in a linked list starting at 0x1). */
export function prevOwnerOf(owners: string[], owner: string): string {
  const i = owners.findIndex((o) => lc(o) === lc(owner));
  return i <= 0 ? SENTINEL : owners[i - 1];
}
