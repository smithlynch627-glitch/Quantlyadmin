import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { ctxFor, decodeCall, validSigners, type Proposal, type SafeInfo } from '../lib/safe';
import { dateTime, short, timeAgo } from '../lib/format';
import type { useSafeActions } from '../lib/useSafe';
import { Address, CopyButton, RowMenu, Status, explorer } from './ui';
import { IconCheck, IconExternal, IconPen, IconTrash, IconUser, IconXCircle, IconZap } from './Icons';

const lc = (x?: string | null) => (x || '').toLowerCase();

export function proposalStatus(p: Proposal, info?: SafeInfo, verified?: number) {
  const sigs = verified ?? p.signatures.filter((s) => !info || info.owners.includes(lc(s.signer))).length;
  const need = info?.threshold ?? 0;
  if (p.status === 'pending' && info && Number(p.nonce) < info.nonce) return { tone: 'neutral' as const, text: 'Nonce already used' };
  if (p.status === 'executed') return { tone: 'good' as const, text: 'Executed' };
  if (p.status === 'failed') return { tone: 'danger' as const, text: 'Failed' };
  if (p.status === 'replaced') return { tone: 'neutral' as const, text: 'Replaced' };
  if (p.status === 'discarded') return { tone: 'neutral' as const, text: 'Removed' };
  if (info && sigs >= need) return Number(p.nonce) === info.nonce ? { tone: 'good' as const, text: 'Ready to execute' } : { tone: 'neutral' as const, text: 'Signed · queued' };
  return { tone: 'warning' as const, text: info ? `Needs ${need - sigs} more signature${need - sigs === 1 ? '' : 's'}` : 'Waiting for signatures' };
}

export function ProposalCard({ p, info, actions, laterCount = 0, names }: {
  p: Proposal; info?: SafeInfo; actions: ReturnType<typeof useSafeActions>; laterCount?: number; names?: Record<string, string>;
}) {
  const { address } = useAccount();
  const me = lc(address);
  const d = info?.safe ? decodeCall(p.to_address, p.value_wei, p.data, ctxFor(info.safe, info.owners.length), names) : null;
  const owners = info?.owners ?? [];
  // Only signatures that really recover to a current owner for this exact hash count.
  const valid = useQuery({
    queryKey: ['valid-signers', p.id, p.safe_tx_hash, p.signatures.map((x) => x.signature).join(','), owners.join(',')],
    queryFn: async () => [...(await validSigners(p, owners)).keys()],
    enabled: owners.length > 0,
    staleTime: Infinity,
  });
  const signers = new Set(valid.data ?? []);
  const sigCount = signers.size;
  const isOwner = owners.includes(me);
  const signed = signers.has(me);
  const isNext = !!info && Number(p.nonce) === info.nonce;
  const used = !!info && Number(p.nonce) < info.nonce;
  const pending = p.status === 'pending';
  const canExecute = pending && isNext && !!valid.data && !!info && (sigCount >= info.threshold || (isOwner && !signed && sigCount + 1 >= info.threshold));
  const st = proposalStatus(p, info, valid.data ? sigCount : undefined);
  const isCancel = !!info?.safe && lc(p.to_address) === info.safe && p.data === '0x';
  const canRemove = pending && (used || p.signatures.length === 0);
  const busy = actions.busy;
  return (
    <article className={`proposal ${pending && isNext ? 'is-next' : ''}`}>
      <div className="proposal__head">
        <span className="proposal__nonce" title="Safe nonce">#{p.nonce}</span>
        <div className="proposal__main">
          <div className="proposal__title">{d ? d.title : p.label}</div>
          <div className="proposal__meta">
            Proposal {p.id} · by {short(p.created_by)} · {timeAgo(p.created_at, 'en')}
            {pending && !isNext && info && <> · runs after nonce {info.nonce}{Number(p.nonce) - info.nonce > 1 ? `–${Number(p.nonce) - 1}` : ''}</>}
          </div>
        </div>
        <Status tone={st.tone}>{st.text}</Status>
      </div>
      <div className="proposal__body">
        {d && !d.known && <div className="alert alert--danger"><IconXCircle size={18} /><div className="alert__body">This call is not one this panel recognises. It will not be signed or executed here.</div></div>}
        {d && d.lines.length > 0 && (
          <div className="proposal__call">
            <dl className="kv">{d.lines.map(([k, v, t]) => <div key={k}><dt>{k}</dt><dd>{t === 'address' && /^0x[0-9a-f]{40}$/i.test(v) ? <Address value={v} label={lc(v) === info?.safe ? 'Safe' : null} /> : v}</dd></div>)}</dl>
          </div>
        )}
        {d && p.label && p.label !== d.title && <div className="small soft">Proposer's note: “{p.label}” (the line above is what the transaction really does)</div>}
        {p.status === 'executed' && p.executed_tx && (
          <div className="small soft row-wrap" style={{ gap: 6 }}>Executed {p.executed_at ? dateTime(p.executed_at, 'en') : ''} by <Address value={p.executed_by} /> · <a className="link" href={explorer('tx', p.executed_tx)} target="_blank" rel="noreferrer">transaction <IconExternal size={12} /></a></div>
        )}
      </div>
      <div className="proposal__foot">
        <div className="sigs" aria-label={`${sigCount} of ${info?.threshold ?? '?'} signatures`}>
          {owners.map((o, i) => (
            <span key={o} className={`sig ${signers.has(o) ? 'is-signed' : ''} ${o === me ? 'is-you' : ''}`} title={`Owner ${i + 1} ${o}${signers.has(o) ? ' — signed' : ' — not signed'}${o === me ? ' (you)' : ''}`}>
              {signers.has(o) ? <IconCheck size={14} /> : <IconUser size={13} />}
            </span>
          ))}
        </div>
        <span className="small soft">{sigCount} of {info?.threshold ?? '?'} signatures</span>
        <span className="spacer" />
        {pending && !used && isOwner && !signed && !canExecute && (
          <button className="btn btn--sm" disabled={!!busy} onClick={() => actions.sign(p, info)}>
            {busy === `sign-${p.id}` ? <span className="spinner" /> : <IconPen size={15} />}Sign
          </button>
        )}
        {pending && isOwner && !signed && canExecute && sigCount < (info?.threshold ?? 0) && (
          <button className="btn btn--sm btn--outline" disabled={!!busy} onClick={() => actions.sign(p, info)}>
            {busy === `sign-${p.id}` ? <span className="spinner" /> : <IconPen size={15} />}Sign only
          </button>
        )}
        {canExecute && (
          <button className="btn btn--sm" disabled={!!busy || (d ? !d.known : true)} onClick={() => actions.execute(p, info)}>
            {busy === `exec-${p.id}` ? <span className="spinner" /> : <IconZap size={15} />}{sigCount >= (info?.threshold ?? 0) ? 'Execute' : 'Sign & execute'}
          </button>
        )}
        {pending && (
          <RowMenu>
            <div className="float-menu__head tiny muted">Safe tx hash {short(p.safe_tx_hash)} <CopyButton value={p.safe_tx_hash} /></div>
            <hr />
            {!used && !isCancel && <button onClick={() => actions.reject(p, info)}><IconXCircle size={16} />Reject on-chain (no-op at nonce {p.nonce})</button>}
            {canRemove
              ? <button className="is-danger" onClick={() => actions.discard(p, used ? 0 : laterCount)}><IconTrash size={16} />Remove from queue</button>
              : <div className="float-menu__head tiny muted" style={{ maxWidth: 260, whiteSpace: 'normal' }}>Signed proposals can't just be removed: their signatures stay valid on-chain. Reject on-chain instead.</div>}
          </RowMenu>
        )}
      </div>
    </article>
  );
}
