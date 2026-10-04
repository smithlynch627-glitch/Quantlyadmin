import { useState } from 'react';
import { useAccount } from 'wagmi';
import type { PageProps } from '../AdminApp';
import { pinnedContracts, NATIVE, WRAPPED } from '../config';
import { factoryAdminAbi, marketAdminAbi } from '../lib/abis';
import { useChainInfo } from '../lib/queries';
import { coinText } from '../lib/safe';
import { useOwnerAction, useSafeInfo } from '../lib/useSafe';
import { useTx } from '../lib/tx';
import { Address, Alert, Card, LoadError, Skeleton, Status, useDialog } from '../components/ui';
import { IconLayers, IconPause, IconPlay, IconSwap, IconVault } from '../components/Icons';

const lc = (x?: string | null) => (x || '').toLowerCase();
const toBps = (v: string) => Math.round(Number(v) * 100);

function OwnerLabel({ owner }: { owner?: string | null }) {
  const info = useSafeInfo();
  const { address } = useAccount();
  return <Address value={owner} label={lc(owner) === info.data?.safe ? 'Safe' : lc(owner) === lc(address) ? 'You' : null} />;
}

function FeeForm({ current, max, onSubmit, busy, hint }: { current: number; max: number; onSubmit: (bps: number) => void; busy: boolean; hint: string }) {
  const [v, setV] = useState('');
  const bps = toBps(v);
  const ok = v.trim() !== '' && Number.isFinite(bps) && bps >= 0 && bps <= max * 100 && bps !== current;
  return (
    <div className="field">
      <label>New fee</label>
      <div className="row" style={{ gap: 8 }}>
        <div className="input-wrap input-wrap--suffix" style={{ maxWidth: 200 }}>
          <input className="input num" inputMode="decimal" placeholder={`${current / 100}`} value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="New fee in percent" />
          <div className="input-wrap__suffix"><span className="small muted" style={{ paddingRight: 8 }}>%</span></div>
        </div>
        <button className="btn btn--sm" disabled={!ok || busy} onClick={() => onSubmit(bps)}>{busy && <span className="spinner" />}Change fee</button>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

export default function Contracts({ go }: PageProps) {
  const chain = useChainInfo();
  const { act, busy } = useOwnerAction();
  const { run, busy: txBusy } = useTx();
  const dialog = useDialog();
  const { address } = useAccount();
  const d = chain.data;
  if (chain.isLoading) return <div className="stack-lg"><Skeleton h={220} r={18} /><Skeleton h={220} r={18} /></div>;
  if (chain.isError) return <LoadError error={chain.error} what="the contracts" retry={() => chain.refetch()} />;
  if (!d?.ready) return <Alert tone="warning" title="Contracts are not set">The API has no contract addresses. Set MARKET_ADDRESS, LAUNCHPAD_FACTORY_ADDRESS and FEE_VAULT_ADDRESS on Railway.</Alert>;
  const m = d.market;
  const market = pinnedContracts().market || m.address;
  const isGuardian = !!d.guardian && lc(d.guardian) === lc(address);

  async function pauseMarket(pause: boolean) {
    const ok = await dialog.confirm({
      title: pause ? 'Pause trading?' : 'Resume trading?', tone: pause ? 'danger' : 'default',
      message: pause ? 'Buys, offer acceptances and batch sends stop. Users can always cancel their orders.' : 'Buys and offer acceptances start working again.',
      confirmLabel: 'Continue',
    });
    if (ok) await act({ contract: market, owner: m.owner, abi: marketAdminAbi, functionName: pause ? 'pause' : 'unpause', label: pause ? 'Pause trading' : 'Resume trading' });
  }
  async function guardianPause() {
    const ok = await dialog.confirm({ title: 'Emergency pause', tone: 'danger', typeToConfirm: 'PAUSE', message: 'Stops trading at once from your pause wallet. Only the Safe can resume it.', confirmLabel: 'Pause now' });
    if (ok) await run('Emergency pause', { address: market, abi: marketAdminAbi, functionName: 'pause' });
  }

  return (
    <div className="stack-lg">
      <Card title={<><IconSwap size={17} />Marketplace</>} sub={`Marketplace contract v${d.marketVersion}`}
        right={m.paused ? <Status tone="danger" icon={<IconPause size={13} />}>Paused</Status> : <Status tone="good">Live</Status>}>
        <div className="grid-2">
          <dl className="kv">
            <div><dt>Contract</dt><dd><Address value={m.address} /></dd></div>
            <div><dt>Owner</dt><dd><OwnerLabel owner={m.owner} /></dd></div>
            <div><dt>Fees go to</dt><dd><Address value={m.feeRecipient} label={lc(m.feeRecipient) === lc(d.vault.address) ? 'FeeVault' : null} /></dd></div>
            <div><dt>Emergency pause wallet</dt><dd>{d.guardian && !/^0x0{40}$/i.test(d.guardian) ? <Address value={d.guardian} label={isGuardian ? 'You' : null} /> : <span className="muted">Not set</span>}</dd></div>
            <div><dt>Trading fee</dt><dd className="strong">{m.feeBps / 100}%</dd></div>
          </dl>
          <div className="stack">
            <FeeForm current={m.feeBps} max={10} busy={!!busy} onSubmit={(bps) => act({ contract: market, owner: m.owner, abi: marketAdminAbi, functionName: 'setMarketFeeBps', args: [bps], label: `Set the trading fee to ${bps / 100}%` })}
              hint="Max 10%. Raising it cancels open orders signed with a lower fee cap (nobody is ever charged more than they signed)." />
            <div className="row-wrap">
              <button className={`btn btn--sm ${m.paused ? '' : 'btn--outline'}`} disabled={!!busy} onClick={() => pauseMarket(!m.paused)}>{m.paused ? <IconPlay size={13} /> : <IconPause size={14} />}{m.paused ? 'Resume trading' : 'Pause trading'}</button>
              {isGuardian && !m.paused && <button className="btn btn--sm btn--danger" disabled={!!txBusy} onClick={guardianPause}><IconPause size={14} />Emergency pause</button>}
            </div>
          </div>
        </div>
      </Card>

      {(d.factories || []).map((f, i) => (
        <Card key={f.address} title={<><IconLayers size={17} />Launchpad factory{d.factories.length > 1 ? ` ${i + 1}` : ''}{f.current && <span className="tag">current</span>}</>}
          sub={f.current ? 'New collections are created here' : 'Earlier version: its collections keep trading'}
          right={f.paused ? <Status tone="warning" icon={<IconPause size={13} />}>Launches paused</Status> : <Status tone="good">Live</Status>}>
          <div className="grid-2">
            <dl className="kv">
              <div><dt>Contract</dt><dd><Address value={f.address} /></dd></div>
              <div><dt>Owner</dt><dd><OwnerLabel owner={f.owner} /></dd></div>
              <div><dt>Mint fee (new collections)</dt><dd className="strong">{f.feeBps === null ? '—' : `${f.feeBps / 100}%`}</dd></div>
            </dl>
            <div className="stack">
              {f.feeBps !== null && <FeeForm current={f.feeBps} max={20} busy={!!busy} onSubmit={(bps) => act({ contract: f.address, owner: f.owner, abi: factoryAdminAbi, functionName: 'setPlatformFeeBps', args: [bps], label: `Set the mint fee to ${bps / 100}%` })}
                hint="Max 20%. Existing collections keep the fee they launched with." />}
              <div className="row-wrap">
                <button className="btn btn--sm btn--outline" disabled={!!busy} onClick={() => act({ contract: f.address, owner: f.owner, abi: factoryAdminAbi, functionName: f.paused ? 'unpause' : 'pause', label: f.paused ? 'Resume collection launches' : 'Pause collection launches' })}>
                  {f.paused ? <IconPlay size={13} /> : <IconPause size={14} />}{f.paused ? 'Resume launches' : 'Pause launches'}
                </button>
              </div>
            </div>
          </div>
        </Card>
      ))}

      <Card title={<><IconVault size={17} />FeeVault</>} sub="Collects the mint fee and the trading fee" right={<button className="btn btn--sm btn--outline" onClick={() => go('treasury')}>Open treasury</button>}>
        <dl className="kv">
          <div><dt>Contract</dt><dd><Address value={d.vault.address} /></dd></div>
          <div><dt>Owner</dt><dd><OwnerLabel owner={d.vault.owner} /></dd></div>
          <div><dt>Balance</dt><dd className="strong">{coinText(d.vault.native)} {NATIVE} · {coinText(d.vault.wrapped)} {WRAPPED}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
