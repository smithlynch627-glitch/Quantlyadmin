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
import { IconLayers, IconPause, IconPen, IconPlay, IconSwap, IconVault } from '../components/Icons';

const lc = (x?: string | null) => (x || '').toLowerCase();
const toBps = (v: string) => Math.round(Number(v) * 100);

function OwnerLabel({ owner }: { owner?: string | null }) {
  const info = useSafeInfo();
  const { address } = useAccount();
  return <Address value={owner} label={lc(owner) === info.data?.safe ? 'Safe' : lc(owner) === lc(address) ? 'You' : null} />;
}

const GAS = { min: 100_000, single: 8_000_000, sweep: 180_000 };
const num = (v: string) => Number(v.replace(/[^0-9]/g, ''));

/**
 * Market v4: how orders may be signed. Wallet (ECDSA) signatures are the default. The switch is for the day those
 * keys are no longer safe (quantum computers, a broken curve): it refuses every wallet-signed order at once, while
 * contract wallets (for example post-quantum wallets, which sign through ERC-1271) keep trading.
 */
function SignatureSafety({ s, onSwitch, onGas, busy }: {
  s: { walletOff: boolean; single: number; sweep: number }; busy: boolean;
  onSwitch: (off: boolean) => void; onGas: (single: number, sweep: number) => void;
}) {
  const [single, setSingle] = useState('');
  const [sweep, setSweep] = useState('');
  const a = single ? num(single) : s.single;
  const b = sweep ? num(sweep) : s.sweep;
  const ok = (single || sweep) && a >= GAS.min && a <= GAS.single && b >= GAS.min && b <= GAS.sweep && (a !== s.single || b !== s.sweep);
  return (
    <Card title={<><IconPen size={17} />Order signatures</>} sub="How the marketplace accepts signed listings and offers"
      right={s.walletOff ? <Status tone="danger">Wallet signatures refused</Status> : <Status tone="good">Normal</Status>}>
      <div className="grid-2">
        <dl className="kv">
          <div><dt>Wallet-signed orders</dt><dd className="strong">{s.walletOff ? 'Refused' : 'Accepted'}</dd></div>
          <div><dt>Contract-wallet check, one trade</dt><dd>{s.single.toLocaleString('en-US')} gas</dd></div>
          <div><dt>Contract-wallet check, each sweep item</dt><dd>{s.sweep.toLocaleString('en-US')} gas</dd></div>
        </dl>
        <div className="stack">
          <div className="field">
            <label>Emergency switch</label>
            <div className="row-wrap">
              <button className={`btn btn--sm ${s.walletOff ? '' : 'btn--danger'}`} disabled={busy} onClick={() => onSwitch(!s.walletOff)}>
                {s.walletOff ? 'Accept wallet signatures again' : 'Refuse wallet signatures'}
              </button>
            </div>
            <span className="hint">Only if wallet keys stop being safe (for example once quantum computers can break them). Every order signed with a wallet key is refused until you switch back; contract wallets keep trading.</span>
          </div>
          <div className="field">
            <label>Contract-wallet signature gas</label>
            <div className="row-wrap" style={{ gap: 8 }}>
              <input className="input num" style={{ maxWidth: 150 }} inputMode="numeric" placeholder={String(s.single)} value={single} onChange={(e) => setSingle(e.target.value)} aria-label="Gas for one trade" />
              <input className="input num" style={{ maxWidth: 150 }} inputMode="numeric" placeholder={String(s.sweep)} value={sweep} onChange={(e) => setSweep(e.target.value)} aria-label="Gas for each sweep item" />
              <button className="btn btn--sm" disabled={!ok || busy} onClick={() => onGas(a, b)}>{busy && <span className="spinner" />}Change gas</button>
            </div>
            <span className="hint">One trade: 100,000 to 8,000,000. Each sweep item: 100,000 to 180,000, so a full sweep of 25 still fits one transaction. Raise it only when wallets with heavier (post-quantum) signatures need it.</span>
          </div>
        </div>
      </div>
    </Card>
  );
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

      {d.signatures && (
        <SignatureSafety s={d.signatures} busy={!!busy}
          onSwitch={async (off) => {
            const ok = await dialog.confirm(off
              ? { title: 'Refuse wallet signatures?', tone: 'danger', typeToConfirm: 'REFUSE', confirmLabel: 'Refuse',
                  message: 'Every listing and offer signed with a wallet key stops working until you switch this back. Only contract wallets (ERC-1271) can trade. Use it only if wallet keys are no longer safe.' }
              : { title: 'Accept wallet signatures again?', confirmLabel: 'Accept', message: 'Orders signed with a wallet key work again.' });
            if (ok) await act({ contract: market, owner: m.owner, abi: marketAdminAbi, functionName: 'setWalletSignaturesOff', args: [off], label: off ? 'Refuse wallet-signed orders' : 'Accept wallet-signed orders again' });
          }}
          onGas={(single, sweep) => act({ contract: market, owner: m.owner, abi: marketAdminAbi, functionName: 'setContractSignatureGas', args: [single, sweep], label: `Contract-wallet signature gas: ${single} per trade, ${sweep} per sweep item` })} />
      )}

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
