import { useMemo, useState } from 'react';
import { encodeFunctionData, formatUnits, isAddress, parseUnits, type Hex } from 'viem';
import type { PageProps } from '../AdminApp';
import { WRAPPED_AT, pinnedContracts, NATIVE, WRAPPED } from '../config';
import { vaultAdminAbi, wrappedAbi } from '../lib/abis';
import { dateTime, timeAgo } from '../lib/format';
import { useChainInfo, useFunds } from '../lib/queries';
import { ctxFor, decodeCall, coinText, pinsProblem, type Proposal } from '../lib/safe';
import { useOwnerAction, useProposals, useSafeActions, useSafeInfo } from '../lib/useSafe';
import { ColumnChart, coinFigure } from '../components/Chart';
import { ProposalCard, proposalStatus } from '../components/ProposalCard';
import { Address, Alert, Card, EmptyState, LoadError, Segmented, Skeleton, Stat, Status, explorer } from '../components/ui';
import { IconArrowDown, IconCoins, IconExternal, IconSend, IconShield, IconVault, IconActivity } from '../components/Icons';

const lc = (x?: string | null) => (x || '').toLowerCase();
const toWei = (v: string) => { try { return v.trim() ? parseUnits(v.trim(), 18) : null; } catch { return null; } };

export default function Treasury({ go }: PageProps) {
  const funds = useFunds();
  const chain = useChainInfo();
  const info = useSafeInfo();
  const queue = useProposals('queue');
  const history = useProposals('history');
  const actions = useSafeActions();
  const f = funds.data;
  const safe = info.data?.isSafe ? info.data.safe : null;

  const moneyQueue = (queue.data?.proposals || []).filter((p) => p.kind === 'withdraw' || p.kind === 'transfer');
  const moneyHistory = (history.data?.proposals || []).filter((p) => p.kind === 'withdraw' || p.kind === 'transfer').slice(0, 12);
  const chart = useMemo(() => (f?.daily || []).map((d) => ({ label: d.day, value: Number(formatUnits(BigInt(d.value), 18)) })), [f?.daily]);

  if (funds.isLoading) return <div className="stack-lg"><div className="stats">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={112} r={18} />)}</div><Skeleton h={320} r={18} /></div>;
  if (funds.isError) return <LoadError error={funds.error} what="the treasury" retry={() => funds.refetch()} />;
  if (!f?.ready) return <Alert tone="warning" title="Contracts are not set">The API has no FeeVault or marketplace address. Set FEE_VAULT_ADDRESS and MARKET_ADDRESS on Railway.</Alert>;
  const earned = BigInt(f.earnings.mint_wei) + BigInt(f.earnings.trade_wei);

  return (
    <div className="stack-lg">
      {!safe && info.data && (
        <Alert tone="warning" title="The contracts are not owned by a Safe">
          The marketplace owner is <span className="mono">{info.data.owner}</span>. Withdrawals are sent straight from that wallet. Move ownership to a multisig for safety.
        </Alert>
      )}
      {safe && pinsProblem() && <Alert tone="warning" title="Signing is disabled on this build">{pinsProblem()}</Alert>}
      {info.data?.mismatch && <Alert tone="danger" title="Unexpected Safe">The marketplace owner is not the Safe built into this admin site. Signing is disabled.</Alert>}

      <div className="stats">
        <Stat label="FeeVault" icon={<IconVault size={16} />} value={coinText(f.vault.native)} unit={NATIVE} sub={<>{coinText(f.vault.wrapped)} {WRAPPED} · ready to withdraw</>} />
        <Stat label="Safe treasury" icon={<IconShield size={16} />} value={f.safe ? coinText(f.safe.native) : '—'} unit={f.safe ? NATIVE : undefined} sub={f.safe ? <>{coinText(f.safe.wrapped)} {WRAPPED} · held by the multisig</> : 'No Safe'} />
        <Stat label="Earned all time" icon={<IconCoins size={16} />} value={coinText(earned)} unit={NATIVE} sub={<>Mint {coinText(f.earnings.mint_wei)} · Trading {coinText(f.earnings.trade_wei)}</>} />
        <Stat label="Last 30 days" icon={<IconActivity size={16} />} value={coinText(f.earnings.last30_wei)} unit={NATIVE} sub="Mint and trading fees" />
      </div>

      <div className="grid-main">
        <div className="stack-lg">
          <Card title="Fees earned per day" sub={`Last 30 days, mint + trading fees (${NATIVE} and ${WRAPPED})`}>
            <ColumnChart data={chart} label="Fees earned per day, last 30 days" format={(n) => `${coinFigure(n)} ${NATIVE}`} dim={funds.isFetching && !funds.isLoading} />
          </Card>

          <Card title="Withdrawal status" sub={safe ? 'Withdrawals and transfers waiting for signatures, and what happened to recent ones' : 'Recent withdrawals'}
            right={safe && <button className="btn btn--sm btn--outline" onClick={() => go('multisig')}>Full queue</button>}>
            {queue.isError && <LoadError error={queue.error} what="the proposal queue" retry={() => queue.refetch()} />}
            {!queue.isError && moneyQueue.length === 0 && moneyHistory.length === 0 && (
              <EmptyState icon={<IconArrowDown size={22} />} title="No withdrawals yet" body="Create one with the form on this page. Owners sign it here, then any owner executes it." />
            )}
            {moneyQueue.map((p) => <ProposalCard key={p.id} p={p} info={info.data} actions={actions} laterCount={(queue.data?.proposals || []).filter((x) => Number(x.nonce) > Number(p.nonce)).length} />)}
            {moneyHistory.length > 0 && (
              <div className="table-wrap">
                <table className="dtable dtable--cards">
                  <thead><tr><th>Withdrawal</th><th>Status</th><th>When</th><th className="right">Transaction</th></tr></thead>
                  <tbody>{moneyHistory.map((p) => <HistoryRow key={p.id} p={p} safe={safe} ownerCount={info.data?.owners.length ?? null} />)}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack-lg">
          <WithdrawCard vault={f.vault} vaultOwner={chain.data?.vault.owner} safe={safe} />
          {safe && f.safe && <SendCard safeBal={f.safe} />}
        </div>
      </div>

      <Card title="FeeVault withdrawal history" sub="Read from the chain, including withdrawals made outside this panel" flush
        right={!f.scan.done && <span className="small soft row" style={{ gap: 8 }}><span className="spinner" />Reading history… {Math.round(f.scan.progress * 100)}%</span>}>
        {f.scan.error && <div style={{ padding: '0 20px 12px' }}><Alert tone="warning" title="History is incomplete">{f.scan.error}</Alert></div>}
        {f.withdrawals.length === 0 ? (
          <EmptyState icon={<IconVault size={22} />} title={f.scan.done ? 'No withdrawals on-chain yet' : 'Still reading the chain'} body={f.scan.done ? `Checked from block ${f.scan.startBlock.toLocaleString()} to ${f.scan.scannedTo.toLocaleString()}.` : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="dtable dtable--cards">
              <thead><tr><th>When</th><th>Asset</th><th className="right">Amount</th><th>Sent to</th><th className="right">Transaction</th></tr></thead>
              <tbody>
                {f.withdrawals.map((w) => {
                  const wrapped = w.name === 'TokenWithdrawn';
                  return (
                    <tr key={`${w.tx_hash}-${w.log_index}`}>
                      <td className="cell-main" data-label="When">{w.block_time ? dateTime(w.block_time, 'en') : `Block ${w.block}`}</td>
                      <td data-label="Asset"><span className="tag">{wrapped ? (lc(w.args.token) === lc(WRAPPED_AT) ? WRAPPED : 'Token') : NATIVE}</span></td>
                      <td data-label="Amount" className="right num strong">{coinText(w.args.amount)}</td>
                      <td data-label="Sent to"><Address value={w.args.to} label={lc(w.args.to) === safe ? 'Safe' : null} /></td>
                      <td data-label="Transaction" className="right"><a className="link small" href={explorer('tx', w.tx_hash)} target="_blank" rel="noreferrer">View <IconExternal size={12} /></a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function HistoryRow({ p, safe, ownerCount }: { p: Proposal; safe: string | null; ownerCount: number | null }) {
  const d = safe ? decodeCall(p.to_address, p.value_wei, p.data, ctxFor(safe, ownerCount)) : null;
  const st = proposalStatus(p);
  return (
    <tr>
      <td className="cell-main" data-label="Withdrawal"><div className="strong">{d?.title || p.label}</div><div className="tiny muted">Proposal {p.id} · nonce {p.nonce}</div></td>
      <td data-label="Status"><Status tone={st.tone}>{st.text}</Status></td>
      <td data-label="When" className="small soft">{timeAgo(p.executed_at || p.created_at, 'en')}</td>
      <td data-label="Transaction" className="right">{p.executed_tx ? <a className="link small" href={explorer('tx', p.executed_tx)} target="_blank" rel="noreferrer">View <IconExternal size={12} /></a> : <span className="muted">—</span>}</td>
    </tr>
  );
}

function WithdrawCard({ vault, vaultOwner, safe }: { vault: { address: string; native: string; wrapped: string }; vaultOwner?: string; safe: string | null }) {
  const { act, busy } = useOwnerAction();
  const [asset, setAsset] = useState<'native' | 'wrapped'>('native');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [dest, setDest] = useState<'safe' | 'other'>(safe ? 'safe' : 'other');
  const [other, setOther] = useState('');
  const bal = BigInt(asset === 'native' ? vault.native : vault.wrapped);
  const wei = max ? bal : toWei(amount);
  const to = dest === 'safe' && safe ? safe : lc(other.trim());
  const toOk = isAddress(to);
  const amountErr = wei === null ? (amount ? 'Enter a number like 0.5' : null) : wei <= 0n ? 'Enter an amount' : wei > bal ? `Only ${coinText(bal)} ${asset} available` : null;
  const valid = wei !== null && wei > 0n && wei <= bal && toOk;
  const owner = lc(vaultOwner);

  async function submit() {
    if (!valid || wei === null) return;
    const vaultAddr = pinnedContracts().vault || vault.address;
    const label = `Withdraw ${max && asset === 'native' ? 'all' : coinText(wei)} ${asset === 'native' ? NATIVE : WRAPPED} to ${to === safe ? 'the Safe' : to}`;
    const r = asset === 'native'
      ? max ? await act({ contract: vaultAddr, owner, abi: vaultAdminAbi, functionName: 'withdrawAllNative', args: [to], label })
        : await act({ contract: vaultAddr, owner, abi: vaultAdminAbi, functionName: 'withdrawNative', args: [to, wei], label })
      : await act({ contract: vaultAddr, owner, abi: vaultAdminAbi, functionName: 'withdrawToken', args: [WRAPPED_AT, to, wei], label });
    if (r) { setAmount(''); setMax(false); }
  }

  return (
    <Card title={<><IconArrowDown size={17} />Withdraw from FeeVault</>} sub={safe ? 'Creates a Safe proposal. Nothing moves until enough owners sign and one executes it.' : 'Sent from the owner wallet.'}>
      <Segmented label="Asset" value={asset} onChange={(v) => { setAsset(v); setMax(false); setAmount(''); }} options={[['native', NATIVE], ['wrapped', WRAPPED]]} />
      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between' }}><label htmlFor="wd-amount">Amount</label><span className="hint">Available {coinText(bal)} {asset}</span></div>
        <div className="input-wrap input-wrap--suffix">
          <input id="wd-amount" className={`input num ${amountErr && amount ? 'input--invalid' : ''}`} inputMode="decimal" placeholder="0.0"
            value={max ? formatUnits(bal, 18) : amount} onChange={(e) => { setMax(false); setAmount(e.target.value.replace(/[^0-9.]/g, '')); }} />
          <div className="input-wrap__suffix"><button type="button" className="btn btn--xs btn--outline" disabled={bal === 0n} onClick={() => setMax(true)}>Max</button></div>
        </div>
        {amountErr && (amount || max) && <span className="hint" style={{ color: 'var(--bad)' }}>{amountErr}</span>}
      </div>
      <div className="field">
        <label>Send to</label>
        <div className="radio-cards">
          {safe && (
            <label className={`radio-card ${dest === 'safe' ? 'is-active' : ''}`}>
              <input type="radio" name="wd-dest" checked={dest === 'safe'} onChange={() => setDest('safe')} />
              <div><b>The Safe (recommended)</b><span>Funds stay under 2-of-3 control. Move them on later with "Send from Safe".</span></div>
            </label>
          )}
          <label className={`radio-card ${dest === 'other' ? 'is-active' : ''}`}>
            <input type="radio" name="wd-dest" checked={dest === 'other'} onChange={() => setDest('other')} />
            <div><b>Another wallet</b><span>Double-check the address. Transfers cannot be reversed.</span></div>
          </label>
        </div>
        {dest === 'other' && <input className={`input mono ${other && !toOk ? 'input--invalid' : ''}`} placeholder="0x… destination" value={other} onChange={(e) => setOther(e.target.value.trim())} />}
      </div>
      <button className="btn btn--block" disabled={!valid || !!busy} onClick={submit}>{busy ? <span className="spinner" /> : <IconArrowDown size={16} />}{safe ? 'Create withdrawal proposal' : 'Withdraw'}</button>
    </Card>
  );
}

function SendCard({ safeBal }: { safeBal: { address: string; native: string; wrapped: string } }) {
  const info = useSafeInfo();
  const { propose, busy } = useSafeActions();
  const [asset, setAsset] = useState<'native' | 'wrapped'>('native');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const bal = BigInt(asset === 'native' ? safeBal.native : safeBal.wrapped);
  const wei = toWei(amount);
  const dest = lc(to.trim());
  const valid = wei !== null && wei > 0n && wei <= bal && isAddress(dest) && dest !== lc(safeBal.address);
  async function submit() {
    if (!valid || wei === null) return;
    const call = asset === 'native'
      ? { to: dest, value: wei, data: '0x' as Hex, label: `Send ${coinText(wei)} ${NATIVE} to ${dest}` }
      : { to: WRAPPED_AT, data: encodeFunctionData({ abi: wrappedAbi, functionName: 'transfer', args: [dest as `0x${string}`, wei] }), label: `Send ${coinText(wei)} ${WRAPPED} to ${dest}` };
    const r = await propose(call, info.data);
    if (r) { setAmount(''); setTo(''); }
  }
  return (
    <Card title={<><IconSend size={16} />Send from Safe</>} sub="Pay out from the multisig treasury, e.g. to an exchange or a team wallet.">
      <Segmented label="Asset" value={asset} onChange={(v) => { setAsset(v); setAmount(''); }} options={[['native', NATIVE], ['wrapped', WRAPPED]]} />
      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between' }}><label htmlFor="send-amount">Amount</label><span className="hint">In the Safe {coinText(bal)} {asset}</span></div>
        <div className="input-wrap input-wrap--suffix">
          <input id="send-amount" className="input num" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          <div className="input-wrap__suffix"><button type="button" className="btn btn--xs btn--outline" disabled={bal === 0n} onClick={() => setAmount(formatUnits(bal, 18))}>Max</button></div>
        </div>
      </div>
      <div className="field"><label htmlFor="send-to">Recipient</label><input id="send-to" className={`input mono ${to && !isAddress(dest) ? 'input--invalid' : ''}`} placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} /></div>
      <button className="btn btn--block btn--outline" disabled={!valid || !!busy} onClick={submit}>{busy ? <span className="spinner" /> : <IconSend size={15} />}Create transfer proposal</button>
    </Card>
  );
}
