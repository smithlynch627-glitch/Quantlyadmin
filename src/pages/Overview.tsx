import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import type { PageProps, Route } from '../AdminApp';
import { fromWei, short, timeAgo } from '../lib/format';
import { RANK, useChainInfo, useFunds, useOverview, useSafeStatus } from '../lib/queries';
import { coinText } from '../lib/safe';
import { useProposals, useSafeInfo } from '../lib/useSafe';
import { useAuthedApi } from '../lib/tx';
import { ColumnChart, coinFigure } from '../components/Chart';
import { Card, EmptyState, Skeleton, Stat, Status, explainError } from '../components/ui';
import { actionIcon, actionTitle } from './Logs';
import { NATIVE, WRAPPED } from '../config';
import {
  IconActivity, IconAlert, IconBag, IconCheckCircle, IconChevronRight, IconCoins, IconLayers, IconLifebuoy, IconPause, IconPen, IconShield, IconSwap, IconUsers, IconVault,
} from '../components/Icons';


export default function Overview({ role, go }: PageProps) {
  const isAdmin = RANK[role] >= RANK.admin;
  const ov = useOverview();
  const chain = useChainInfo();
  const funds = useFunds(isAdmin);
  const safeStatus = useSafeStatus(isAdmin);
  const info = useSafeInfo();
  const queue = useProposals('queue', isAdmin);
  const { address } = useAccount();
  const authed = useAuthedApi();
  const recent = useQuery({ queryKey: ['admin-audit-recent'], queryFn: () => authed.get<{ entries: any[] }>('/admin/audit', { limit: 6 }), enabled: isAdmin, refetchInterval: 30_000 });
  const d = ov.data;
  const chart = useMemo(() => (d?.daily || []).map((x) => ({ label: x.day, value: Number(formatUnits(BigInt(x.value), 18)) })), [d?.daily]);

  if (ov.isLoading) return <div className="stack-lg"><div className="stats">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={108} r={18} />)}</div><Skeleton h={300} r={18} /></div>;
  if (!d) return <EmptyState title="Could not load the overview" body={(ov.error as Error)?.message} />;
  const s = d.stats;
  const me = (address || '').toLowerCase();
  const toSign = (queue.data?.proposals || []).filter((p) => info.data?.owners.includes(me) && !p.signatures.some((x) => x.signer === me));
  const ready = (queue.data?.proposals || []).filter((p) => info.data && Number(p.nonce) === info.data.nonce && p.signatures.filter((x) => info.data!.owners.includes(x.signer)).length >= info.data.threshold);
  const problems = (safeStatus.data?.checks || []).filter((c) => !c.ok && c.level !== 'info');
  const m = chain.data?.market;
  const pausedFactories = (chain.data?.factories || []).filter((f) => f.paused);

  const attention: { icon: JSX.Element; title: string; sub: string; to: Route; tone: 'warning' | 'danger' | 'neutral' }[] = [];
  if (toSign.length) attention.push({ icon: <IconPen size={16} />, title: `${toSign.length} proposal${toSign.length > 1 ? 's' : ''} waiting for your signature`, sub: toSign.map((p) => p.label).slice(0, 2).join(' · '), to: 'multisig', tone: 'warning' });
  if (ready.length) attention.push({ icon: <IconCheckCircle size={16} />, title: 'Ready to execute', sub: ready[0].label, to: 'multisig', tone: 'neutral' });
  problems.forEach((p) => attention.push({ icon: <IconShield size={16} />, title: p.title, sub: p.detail, to: 'multisig', tone: p.level === 'danger' ? 'danger' : 'warning' }));
  if (m?.paused) attention.push({ icon: <IconPause size={16} />, title: 'Trading is paused', sub: 'Buys and offer acceptances are stopped.', to: 'contracts', tone: 'danger' });
  if (pausedFactories.length) attention.push({ icon: <IconPause size={16} />, title: 'Launches are paused', sub: `${pausedFactories.length} launchpad factory paused`, to: 'contracts', tone: 'warning' });
  if (d.tickets.open) attention.push({ icon: <IconLifebuoy size={16} />, title: `${d.tickets.open} open support ticket${d.tickets.open > 1 ? 's' : ''}`, sub: `${d.tickets.waiting} waiting on the user`, to: 'support', tone: 'neutral' });
  if (funds.isError || safeStatus.isError) {
    const err = funds.isError ? funds.error : safeStatus.error;
    attention.unshift({ icon: <IconAlert size={16} />, title: 'Treasury and multisig data could not load', sub: explainError(err), to: funds.isError ? 'treasury' : 'multisig', tone: 'danger' });
  }
  if (d.network.status?.degraded) attention.push({ icon: <IconAlert size={16} />, title: 'The indexer is behind', sub: 'Check the RPC and the indexer on Railway.', to: 'network', tone: 'danger' });

  return (
    <div className="stack-lg">
      {isAdmin && (
        <div className="stats">
          <button className="stat stat--link" onClick={() => go('contracts')}>
            <span className="stat__label"><span className="stat__icon"><IconSwap size={16} /></span>Marketplace</span>
            <span className="row" style={{ gap: 8 }}>{m ? (m.paused ? <Status tone="danger" icon={<IconPause size={13} />}>Paused</Status> : <Status tone="good">Live</Status>) : <Skeleton h={26} w={80} />}</span>
            <span className="stat__sub">{m ? `Trading fee ${m.feeBps / 100}% · v${chain.data?.marketVersion}` : ' '}</span>
          </button>
          <button className="stat stat--link" onClick={() => go('contracts')}>
            <span className="stat__label"><span className="stat__icon"><IconLayers size={16} /></span>Launchpad</span>
            <span className="row" style={{ gap: 8 }}>{chain.data ? (pausedFactories.length ? <Status tone="warning" icon={<IconPause size={13} />}>Paused</Status> : <Status tone="good">Live</Status>) : <Skeleton h={26} w={80} />}</span>
            <span className="stat__sub">{chain.data ? `Mint fee ${chain.data.factory.feeBps / 100}%` : ' '}</span>
          </button>
          <button className="stat stat--link" onClick={() => go('multisig')}>
            <span className="stat__label"><span className="stat__icon"><IconShield size={16} /></span>Multisig</span>
            <span className="stat__value">{info.data?.isSafe ? `${info.data.threshold} of ${info.data.owners.length}` : info.data ? 'Not set' : '…'}</span>
            <span className="stat__sub">{(queue.data?.proposals.length ?? 0)} pending · nonce {info.data?.nonce ?? '—'}</span>
          </button>
          <button className="stat stat--link" onClick={() => go('treasury')}>
            <span className="stat__label"><span className="stat__icon"><IconVault size={16} /></span>FeeVault</span>
            <span className="stat__value">{funds.data?.ready ? coinText(funds.data.vault.native) : funds.isError ? '—' : '…'}{funds.data?.ready && <small>{NATIVE}</small>}</span>
            <span className="stat__sub">{funds.data?.ready ? `${coinText(funds.data.vault.wrapped)} ${WRAPPED} ready to withdraw` : ' '}</span>
          </button>
        </div>
      )}

      <div className="grid-main">
        <div className="stack-lg">
          <Card title="Sales volume" sub="Per day, last 30 days" right={<span className="small soft">{fromWei(s.volume_24h_wei)} {NATIVE} in the last 24h</span>}>
            <ColumnChart data={chart} label="Sales volume per day, last 30 days" format={(n) => `${coinFigure(n)} ${NATIVE}`} dim={ov.isFetching && !ov.isLoading} />
          </Card>
          <div className="stats">
            <Stat label="Volume, all time" icon={<IconActivity size={16} />} value={fromWei(s.volume_wei)} unit={NATIVE} sub={`${s.sales.toLocaleString()} sales`} />
            <Stat label="Active listings & offers" icon={<IconBag size={16} />} value={s.active_orders.toLocaleString()} sub={`${s.tokens.toLocaleString()} items indexed`} />
            <Stat label="Collections" icon={<IconLayers size={16} />} value={s.collections.toLocaleString()} sub={`${s.hidden_collections} hidden`} />
            <Stat label="Users" icon={<IconUsers size={16} />} value={s.users.toLocaleString()} sub="Signed in at least once" />
            <Stat label="Fees earned" icon={<IconCoins size={16} />} value={fromWei(String(BigInt(s.mint_fees_wei) + BigInt(s.trade_fees_wei)))} unit={NATIVE} sub={`Mint ${fromWei(s.mint_fees_wei)} · Trading ${fromWei(s.trade_fees_wei)}`} />
          </div>
        </div>

        <div className="stack-lg">
          <Card title="Needs attention" flush>
            {attention.length === 0 ? (
              <EmptyState icon={<IconCheckCircle size={22} />} title="All clear" body="Nothing is waiting for you right now." />
            ) : (
              <div className="list">
                {attention.map((a, i) => (
                  <a key={i} href={`#/${a.to}`} className="list-item" style={{ cursor: 'pointer' }}>
                    <span className="list-item__icon" style={a.tone === 'danger' ? { background: 'var(--bad-bg)', color: 'var(--bad)' } : a.tone === 'warning' ? { background: 'var(--warn-bg)' } : undefined}>{a.icon}</span>
                    <div className="list-item__main"><span className="list-item__title">{a.title}</span><span className={`list-item__sub ${a.tone === 'danger' ? '' : 'ellipsis'}`}>{a.sub}</span></div>
                    <IconChevronRight size={16} />
                  </a>
                ))}
              </div>
            )}
          </Card>
          {isAdmin && (
            <Card title="Recent admin activity" flush right={<button className="btn btn--xs btn--ghost" onClick={() => go('logs')}>View all</button>}>
              {!recent.data ? <div style={{ padding: 20 }}><Skeleton h={120} /></div> : recent.data.entries.length === 0 ? <EmptyState title="No activity yet" /> : (
                <div className="list">
                  {recent.data.entries.map((e) => (
                    <div className="list-item" key={e.id}>
                      <span className="list-item__icon">{actionIcon(e.action)}</span>
                      <div className="list-item__main"><span className="list-item__title ellipsis">{actionTitle(e)}</span><span className="list-item__sub">{short(e.actor)} · {timeAgo(e.created_at, 'en')}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
