import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, isAddress, zeroAddress } from 'viem';
import { useAccount } from 'wagmi';
import type { PageProps } from '../AdminApp';
import { pinnedContracts, NATIVE, WRAPPED } from '../config';
import { marketAdminAbi, safeAbi } from '../lib/abis';
import { dateTime, short, timeAgo } from '../lib/format';
import { RANK, useSafeStatus, type SafeHistoryItem } from '../lib/queries';
import { ctxFor, decodeCall, coinText, pinsProblem, prevOwnerOf } from '../lib/safe';
import { useProposals, useSafeActions, useSafeInfo } from '../lib/useSafe';
import { useAuthedApi, useTx } from '../lib/tx';
import { ProposalCard, proposalStatus } from '../components/ProposalCard';
import { Address, Alert, Card, EmptyState, LoadError, Modal, Segmented, Skeleton, Status, explorer, useDialog, useToast } from '../components/ui';
import { IconAlert, IconCheck, IconExternal, IconInfo, IconKey, IconPause, IconPen, IconShield, IconUsers, IconWarning } from '../components/Icons';

const lc = (x?: string | null) => (x || '').toLowerCase();

export default function Multisig({ role }: PageProps) {
  const status = useSafeStatus();
  const info = useSafeInfo();
  const queue = useProposals('queue');
  const history = useProposals('history');
  const actions = useSafeActions();
  const { address } = useAccount();
  const me = lc(address);
  const [histTab, setHistTab] = useState<'panel' | 'chain'>('panel');
  const [ownersOpen, setOwnersOpen] = useState(false);
  const s = status.data;

  if (status.isLoading) return <div className="stack-lg"><Skeleton h={170} r={18} /><div className="grid-main"><Skeleton h={320} r={18} /><Skeleton h={320} r={18} /></div></div>;
  if (status.isError) return <LoadError error={status.error} what="the multisig status" retry={() => status.refetch()} />;
  if (!s?.ready) return <Alert tone="warning" title="Contracts are not set">The API has no marketplace address. Set MARKET_ADDRESS on Railway.</Alert>;
  if (!s.safe) {
    return (
      <div className="stack-lg">
        <Alert tone="warning" title="No Safe owns the marketplace yet">
          The marketplace owner is <span className="mono">{s.owner}</span>, a normal wallet: one stolen key controls fees, pausing and withdrawals. Create a 2-of-3 Safe with
          <span className="mono"> create-safe.ps1</span> and hand ownership over with <span className="mono">upgrade-v3.ps1</span>; this page then shows owners, signatures and the queue.
        </Alert>
        <ManagedCard s={s} />
      </div>
    );
  }
  const safe = s.safe;
  const isOwner = safe.owners.some((o) => o.address === me);
  const pending = queue.data?.proposals || [];
  const needMine = pending.filter((p) => isOwner && !p.signatures.some((x) => lc(x.signer) === me));
  const problems = (s.checks || []).filter((c) => !c.ok && c.level !== 'info');

  return (
    <div className="stack-lg">
      {pinsProblem() && <Alert tone="warning" title="Signing is disabled on this build">{pinsProblem()}</Alert>}
      {info.data?.mismatch && <Alert tone="danger" title="Unexpected Safe">The marketplace owner does not match VITE_SAFE_ADDRESS built into this admin site. Signing and executing are disabled.</Alert>}
      {problems.length > 0 && <Alert tone={problems.some((p) => p.level === 'danger') ? 'danger' : 'warning'} title={`${problems.length} security check${problems.length > 1 ? 's' : ''} need attention`}>{problems.map((p) => p.title).join(' · ')}</Alert>}

      <Card>
        <div className="safe-hero">
          <div className="ring" style={{ ['--p' as any]: safe.threshold / Math.max(1, safe.owners.length) }} aria-label={`${safe.threshold} of ${safe.owners.length} signatures`}>
            <div><b>{safe.threshold}/{safe.owners.length}</b><span>signatures</span></div>
          </div>
          <div className="safe-hero__main">
            <div className="row-wrap" style={{ gap: 8 }}><span className="card__title">Safe multisig</span><span className="tag">v{safe.version}</span><Status tone="good">Owns the marketplace</Status></div>
            <Address value={safe.address} full />
            <div className="small soft">Nonce {safe.nonce} · {coinText(safe.balances.native)} {NATIVE} · {coinText(safe.balances.wrapped)} {WRAPPED}</div>
          </div>
          <div className="stack" style={{ gap: 8, minWidth: 220 }}>
            {isOwner ? (
              <Alert tone={needMine.length ? 'warning' : 'good'} icon={needMine.length ? <IconPen size={18} /> : <IconCheck size={18} />} title={needMine.length ? `${needMine.length} waiting for your signature` : 'You are a Safe owner'}>
                {needMine.length ? 'Review and sign below.' : 'Nothing is waiting for you.'}
              </Alert>
            ) : (
              <Alert icon={<IconInfo size={18} />} title="View only">This wallet is not a Safe owner. You can propose; owners sign.</Alert>
            )}
          </div>
        </div>
      </Card>

      <div className="grid-main">
        <div className="stack-lg">
          <Card title="Transaction queue" sub={`Executed strictly in nonce order. The next one is #${safe.nonce}.`}
            right={<span className="small soft">{pending.length} pending</span>}>
            {queue.isError ? <LoadError error={queue.error} what="the proposal queue" retry={() => queue.refetch()} /> : queue.isLoading ? <Skeleton h={160} r={14} /> : pending.length === 0 ? (
              <EmptyState icon={<IconShield size={22} />} title="Nothing waiting" body="Proposals from Treasury, Collections and Contracts appear here for owners to sign." />
            ) : (
              <div>{pending.map((p) => <ProposalCard key={p.id} p={p} info={info.data} actions={actions} laterCount={pending.filter((x) => Number(x.nonce) > Number(p.nonce)).length} />)}</div>
            )}
          </Card>

          <Card title="History" flush right={<Segmented label="History source" value={histTab} onChange={setHistTab} options={[['panel', 'Panel proposals'], ['chain', 'All Safe transactions']]} />}>
            {histTab === 'panel' ? <PanelHistory items={history.data?.proposals || []} safe={safe.address} ownerCount={safe.owners.length} /> : <ChainHistory items={s.history || []} safe={safe.address} ownerCount={safe.owners.length} scanning={!s.scan?.done} progress={s.scan?.progress ?? 0} />}
          </Card>
        </div>

        <div className="stack-lg">
          <Card title="Security checks" sub="Read from the Safe contract just now">
            <div className="checks">
              {(s.checks || []).map((c) => (
                <div key={c.id} className={`check ${c.ok ? '' : `check--${c.level || 'warning'}`}`}>
                  <span className="check__icon">{c.ok ? <IconCheck size={14} /> : c.level === 'info' ? <IconInfo size={14} /> : c.level === 'danger' ? <IconAlert size={14} /> : <IconWarning size={14} />}</span>
                  <div style={{ minWidth: 0 }}><b>{c.title}</b><span>{c.detail}</span></div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Owners" sub={`${safe.threshold} of ${safe.owners.length} must sign`} right={<button className="btn btn--sm btn--outline" onClick={() => setOwnersOpen(true)}><IconUsers size={15} />Change owners</button>} flush>
            <div className="list">
              {safe.owners.map((o, i) => <OwnerRow key={o.address} index={i} owner={o} me={me} canGrant={RANK[role] >= RANK.owner} />)}
            </div>
          </Card>

          <GuardianCard guardian={s.guardian} />
          <ManagedCard s={s} />
        </div>
      </div>

      {ownersOpen && <OwnersModal owners={safe.owners.map((o) => o.address)} threshold={safe.threshold} onClose={() => setOwnersOpen(false)} />}
    </div>
  );
}

function OwnerRow({ index, owner, me, canGrant }: { index: number; owner: { address: string; panelRole: string | null }; me: string; canGrant: boolean }) {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const qc = useQueryClient();
  async function grant() {
    const ok = await dialog.confirm({ title: 'Give panel access?', message: <>Adds <span className="mono">{short(owner.address)}</span> as an <b>admin</b>, so this owner can sign proposals in the panel.</>, confirmLabel: 'Give access' });
    if (!ok) return;
    try {
      await authed.post('/admin/admins', { address: owner.address, role: 'admin' });
      toast('Access granted. The owner can now sign in and sign proposals.');
      qc.invalidateQueries({ queryKey: ['admin-safe'] });
    } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <div className="list-item">
      <span className="list-item__icon"><IconKey size={16} /></span>
      <div className="list-item__main">
        <span className="list-item__title row" style={{ gap: 6 }}>Owner {index + 1}{owner.address === me && <span className="addr__label">You</span>}</span>
        <Address value={owner.address} />
      </div>
      {owner.panelRole ? <span className="tag">{owner.panelRole}</span> : canGrant ? <button className="btn btn--xs btn--outline" onClick={grant}>Give access</button> : <span className="tag" title="Cannot sign in to this panel">No access</span>}
    </div>
  );
}

function GuardianCard({ guardian }: { guardian: string | null }) {
  const { address } = useAccount();
  const info = useSafeInfo();
  const { propose, busy } = useSafeActions();
  const { run, busy: txBusy } = useTx();
  const dialog = useDialog();
  const none = !guardian || guardian === zeroAddress;
  const isGuardian = !none && lc(guardian) === lc(address);
  const { market } = pinnedContracts();
  async function emergency() {
    const ok = await dialog.confirm({
      title: 'Pause trading now?', tone: 'danger', typeToConfirm: 'PAUSE',
      message: 'Buys, offer acceptances and batch sends stop at once. Users can still cancel. Only the Safe can resume trading.', confirmLabel: 'Pause trading',
    });
    if (ok) await run('Emergency pause', { address: market, abi: marketAdminAbi, functionName: 'pause' });
  }
  async function change() {
    const v = await dialog.prompt({
      title: none ? 'Set an emergency pause wallet' : 'Change the emergency pause wallet', label: 'Wallet address (0x0000… removes it)', placeholder: '0x…',
      message: 'This wallet can only pause trading. Use a separate wallet that is always at hand (not a Safe owner key).',
      validate: (x) => (isAddress(x.trim()) ? null : 'Enter a valid address'), confirmLabel: 'Continue',
    });
    if (!v) return;
    await propose({ to: market, data: encodeFunctionData({ abi: marketAdminAbi, functionName: 'setGuardian', args: [lc(v) as `0x${string}`] }) }, info.data);
  }
  return (
    <Card title="Emergency pause" sub="A single wallet that can stop trading instantly, without waiting for signatures">
      {none ? <Alert tone="warning" title="Not set">Pausing then needs owner signatures, which takes longer in an emergency.</Alert> : <div className="row" style={{ justifyContent: 'space-between' }}><span className="small soft">Pause wallet</span><Address value={guardian} label={isGuardian ? 'You' : null} /></div>}
      <div className="row-wrap">
        {isGuardian && <button className="btn btn--sm btn--danger" disabled={!!txBusy} onClick={emergency}>{txBusy ? <span className="spinner" /> : <IconPause size={15} />}Pause trading now</button>}
        {info.data?.isSafe && <button className="btn btn--sm btn--outline" disabled={!!busy} onClick={change}>{none ? 'Set pause wallet' : 'Change'}</button>}
      </div>
    </Card>
  );
}

function ManagedCard({ s }: { s: { managed: { key: string; name: string; address: string; owner: string | null; pendingOwner: string | null; paused: boolean | null; ownedBySafe: boolean }[]; safe: { address: string } | null } }) {
  return (
    <Card title="Contracts controlled" sub="Who owns each marketplace contract right now" flush>
      <div className="list">
        {s.managed.map((m) => (
          <div className="list-item" key={m.key}>
            <div className="list-item__main">
              <span className="list-item__title row" style={{ gap: 8 }}>{m.name}{m.paused && <Status tone="warning" icon={<IconPause size={12} />}>Paused</Status>}</span>
              <Address value={m.address} />
            </div>
            {m.ownedBySafe ? <Status tone="good">Safe</Status>
              : m.pendingOwner && s.safe && lc(m.pendingOwner) === lc(s.safe.address) ? <Status tone="warning">Awaiting accept</Status>
              : <Status tone="danger" icon={<IconAlert size={13} />}>{short(m.owner)}</Status>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PanelHistory({ items, safe, ownerCount }: { items: import('../lib/safe').Proposal[]; safe: string; ownerCount: number }) {
  if (!items.length) return <EmptyState title="No finished proposals yet" body="Executed, replaced and removed proposals show here." />;
  return (
    <div className="table-wrap">
      <table className="dtable dtable--cards">
        <thead><tr><th>Proposal</th><th>Status</th><th>Signers</th><th>When</th><th className="right">Transaction</th></tr></thead>
        <tbody>
          {items.map((p) => {
            const d = decodeCall(p.to_address, p.value_wei, p.data, ctxFor(safe, ownerCount));
            const st = proposalStatus(p);
            return (
              <tr key={p.id}>
                <td className="cell-main" data-label="Proposal"><div className="strong">{d.known ? d.title : p.label}</div><div className="tiny muted">#{p.id} · nonce {p.nonce} · by {short(p.created_by)}</div></td>
                <td data-label="Status"><Status tone={st.tone}>{st.text}</Status></td>
                <td data-label="Signers" className="small">{p.signatures.length}</td>
                <td data-label="When" className="small soft nowrap">{timeAgo(p.executed_at || p.created_at, 'en')}</td>
                <td data-label="Transaction" className="right">{p.executed_tx ? <a className="link small" href={explorer('tx', p.executed_tx)} target="_blank" rel="noreferrer">View <IconExternal size={12} /></a> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChainHistory({ items, safe, ownerCount, scanning, progress }: { items: SafeHistoryItem[]; safe: string; ownerCount: number; scanning: boolean; progress: number }) {
  const ctx = useMemo(() => ctxFor(safe, ownerCount), [safe, ownerCount]);
  if (!items.length) return <EmptyState title={scanning ? `Reading the chain… ${Math.round(progress * 100)}%` : 'No Safe transactions yet'} />;
  return (
    <div className="table-wrap">
      <table className="dtable dtable--cards">
        <thead><tr><th>Nonce</th><th>What it did</th><th>Result</th><th>Executed by</th><th className="right">When</th></tr></thead>
        <tbody>
          {items.map((h) => {
            const d = h.to && h.data !== null ? decodeCall(h.to, h.value, h.data, ctx) : null;
            const title = d?.known ? d.title : h.changes.length ? h.changes.map((c) => c.name.replace(/([A-Z])/g, ' $1').trim()).join(', ') : d ? `Call to ${short(h.to)}` : 'Safe event';
            return (
              <tr key={h.tx_hash}>
                <td data-label="Nonce"><span className="tag">{h.nonce ?? '—'}</span></td>
                <td className="cell-main" data-label="What it did"><div className="strong">{title}</div>{h.changes.length > 0 && d?.known && <div className="tiny muted">{h.changes.map((c) => c.name).join(', ')}</div>}</td>
                <td data-label="Result">{h.success === null ? <Status>Event</Status> : h.success ? <Status tone="good">Success</Status> : <Status tone="danger">Failed</Status>}</td>
                <td data-label="Executed by">{h.executor ? <Address value={h.executor} /> : <span className="muted">—</span>}</td>
                <td data-label="When" className="right small"><a className="link" href={explorer('tx', h.tx_hash)} target="_blank" rel="noreferrer">{h.time ? dateTime(h.time, 'en') : `Block ${h.block}`} <IconExternal size={12} /></a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type OwnerAction = 'replace' | 'add' | 'remove' | 'threshold';
function OwnersModal({ owners, threshold, onClose }: { owners: string[]; threshold: number; onClose: () => void }) {
  const info = useSafeInfo();
  const { propose, busy } = useSafeActions();
  const dialog = useDialog();
  const [action, setAction] = useState<OwnerAction>('replace');
  const [oldOwner, setOldOwner] = useState(owners[0]);
  const [newOwner, setNewOwner] = useState('');
  const [th, setTh] = useState(threshold);
  const n = owners.length;
  const nw = lc(newOwner.trim());
  const newOk = isAddress(nw) && !owners.includes(nw) && nw !== lc(info.data?.safe);
  const maxTh = action === 'add' ? n + 1 : action === 'remove' ? n - 1 : n;
  const valid = action === 'replace' ? newOk : action === 'add' ? newOk && th >= 2 && th <= n + 1 : action === 'remove' ? n > 2 && th >= 2 && th <= n - 1 : th >= 2 && th <= n && th !== threshold;
  const safe = info.data?.safe as `0x${string}` | undefined;

  async function submit() {
    if (!safe || !valid) return;
    const data = action === 'replace' ? encodeFunctionData({ abi: safeAbi, functionName: 'swapOwner', args: [prevOwnerOf(owners, oldOwner) as `0x${string}`, oldOwner as `0x${string}`, nw as `0x${string}`] })
      : action === 'add' ? encodeFunctionData({ abi: safeAbi, functionName: 'addOwnerWithThreshold', args: [nw as `0x${string}`, BigInt(th)] })
      : action === 'remove' ? encodeFunctionData({ abi: safeAbi, functionName: 'removeOwner', args: [prevOwnerOf(owners, oldOwner) as `0x${string}`, oldOwner as `0x${string}`, BigInt(th)] })
      : encodeFunctionData({ abi: safeAbi, functionName: 'changeThreshold', args: [BigInt(th)] });
    const ok = await dialog.confirm({
      title: 'Change who controls the marketplace?', tone: 'danger', typeToConfirm: 'CHANGE OWNERS',
      message: 'Owners control fees, pausing, withdrawals and every future owner change. A wrong address can lock you out or hand control to someone else. Check every character.',
      confirmLabel: 'Continue',
    });
    if (!ok) return;
    const r = await propose({ to: safe, data }, info.data);
    if (r) onClose();
  }

  return (
    <Modal open onClose={onClose} title="Change owners" width={560}>
      <Alert tone="danger" title="High-risk change">This creates a Safe proposal that {threshold} owners must sign. If an owner wallet was hacked, sign with the healthy owners and execute from a healthy wallet.</Alert>
      <Segmented label="Change" value={action} onChange={(v) => { setAction(v); setTh(Math.max(2, v === 'remove' ? Math.min(threshold, n - 1) : threshold)); }}
        options={[['replace', 'Replace'], ['add', 'Add'], ['remove', 'Remove'], ['threshold', 'Threshold']]} />
      {action === 'remove' && n <= 2 && <Alert tone="warning" title="Add an owner first">At least 2 owners must stay, so with {n} owners you can replace one but not remove one.</Alert>}
      {(action === 'replace' || action === 'remove') && (
        <div className="field"><label>{action === 'replace' ? 'Owner to replace (lost or hacked)' : 'Owner to remove'}</label>
          <select className="select mono" value={oldOwner} onChange={(e) => setOldOwner(e.target.value)}>{owners.map((o, i) => <option key={o} value={o}>Owner {i + 1} · {o}</option>)}</select></div>
      )}
      {(action === 'replace' || action === 'add') && (
        <div className="field"><label>New owner wallet</label>
          <input className={`input mono ${newOwner && !newOk ? 'input--invalid' : ''}`} placeholder="0x… a fresh wallet never used anywhere" value={newOwner} onChange={(e) => setNewOwner(e.target.value.trim())} />
          {newOwner && !newOk && <span className="hint" style={{ color: 'var(--bad)' }}>{!isAddress(nw) ? 'Not a valid address' : 'Already an owner'}</span>}</div>
      )}
      {action !== 'replace' && (
        <div className="field"><label>Signatures needed {action === 'threshold' ? '' : 'after the change'}</label>
          <select className="select" value={th} onChange={(e) => setTh(Number(e.target.value))}>{Array.from({ length: Math.max(0, maxTh - 1) }, (_, i) => i + 2).map((x) => <option key={x} value={x}>{x} of {maxTh}</option>)}</select>
          <span className="hint">At least 2 signatures, so one stolen key can never act alone.</span></div>
      )}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn--outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn btn--danger" style={{ flex: 1.4 }} disabled={!valid || !!busy} onClick={submit}>{busy ? <span className="spinner" /> : null}Create proposal</button>
      </div>
    </Modal>
  );
}
