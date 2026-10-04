import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { short, timeAgo } from '../lib/format';
import { useAuthedApi } from '../lib/tx';
import { Alert, Card, Skeleton, Status, useDialog, useToast } from '../components/ui';
import { IconCheckCircle, IconLock, IconXCircle } from '../components/Icons';

type Net = Record<string, any>;
const FIELDS: [string, string][] = [
  ['name', 'Display name'], ['rpc_url', 'Server RPC URL (can be private)'], ['public_rpc_url', 'Browser RPC URL (https)'],
  ['explorer_url', 'Explorer URL'], ['explorer_api_url', 'Explorer API v2 URL (Blockscout, for imports)'], ['market_address', 'Marketplace address'],
  ['factory_address', 'Launchpad factory address'], ['fee_vault_address', 'FeeVault address'], ['wrapped_address', 'Wrapped coin (WQMS) address'],
  ['official_collection', 'Official collection address'], ['start_block', 'Indexer start block'],
];

export default function Network(_: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const q = useQuery({ queryKey: ['admin-networks'], queryFn: () => authed.get<{ networks: Net[]; locked?: boolean }>('/admin/networks') });
  const [adding, setAdding] = useState(false);
  async function activate(n: Net) {
    const ok = await dialog.confirm({
      title: `Switch the whole marketplace to ${n.name}?`, tone: 'danger', typeToConfirm: n.key,
      message: `Every API server, the indexer and the website move to chain ${n.chain_id} within seconds. Data of the current network is kept, so you can switch back.`,
      confirmLabel: 'Switch network',
    });
    if (!ok) return;
    try {
      await authed.post(`/admin/networks/${n.key}/activate`, { confirm: n.key });
      toast(`Switched to ${n.name}. Reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) { toast(e.message, 'error'); }
  }
  if (!q.data) return <Skeleton h={300} r={18} />;
  return (
    <div className="stack-lg">
      {q.data.locked ? (
        <Alert icon={<IconLock size={18} />} title="Locked for security">
          Contract addresses and RPCs come from the server variables on Railway (MARKET_ADDRESS, RPC_URL, …), so even a stolen admin session can't point the
          marketplace at other contracts. To edit here, set ALLOW_NETWORK_EDITS=1 on Railway, make the change, then remove it again.
        </Alert>
      ) : (
        <Alert tone="warning" title="Editing is unlocked">
          To move to QMS mainnet (or a new testnet after a reset): deploy the contracts there, add the network with its RPC and addresses, press Test, then Activate. Remove ALLOW_NETWORK_EDITS on Railway afterwards.
        </Alert>
      )}
      {q.data.networks.map((n) => <NetworkCard key={n.key} n={n} locked={!!q.data!.locked} onActivate={() => activate(n)} onSaved={() => q.refetch()} />)}
      {!q.data.locked && (adding
        ? <NetworkCard n={{ key: '', chain_id: '', is_testnet: false, wrapped_address: '0x9aa510295ac664a3d5a3182a3efe959de2b12c34' }} isNew locked={false} onSaved={() => { setAdding(false); q.refetch(); }} />
        : <div><button className="btn btn--outline" onClick={() => setAdding(true)}>Add network</button></div>)}
    </div>
  );
}

function NetworkCard({ n, isNew, locked, onActivate, onSaved }: { n: Net; isNew?: boolean; locked: boolean; onActivate?: () => void; onSaved: () => void }) {
  const authed = useAuthedApi();
  const toast = useToast();
  const [f, setF] = useState<Net>({ ...n });
  const [checks, setChecks] = useState<{ check: string; ok: boolean; detail: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const body = () => Object.fromEntries([...FIELDS.map(([k]) => [k, f[k] === '' ? null : f[k]]), ['is_testnet', !!f.is_testnet]]);
  async function save() {
    setBusy(true);
    try {
      const r = isNew ? await authed.post<{ checks: any[] }>('/admin/networks', { ...body(), key: f.key, chain_id: Number(f.chain_id) }) : await authed.put<{ checks: any[] }>(`/admin/networks/${n.key}`, body());
      setChecks(r.checks); toast('Network saved'); onSaved();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function test() {
    try { setChecks((await authed.post<{ checks: any[] }>(`/admin/networks/${n.key}/test`)).checks); } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <Card title={isNew ? 'New network' : `${n.name}`} sub={isNew ? undefined : `Chain ${n.chain_id}${n.is_testnet ? ' · testnet' : ''} · last change ${n.updated_at ? timeAgo(n.updated_at, 'en') : '—'}${n.updated_by ? ` by ${short(n.updated_by)}` : ''}`}
      right={n.is_active ? <Status tone="good">Active</Status> : undefined}
      foot={<>
        {!locked && <button className="btn" disabled={busy} onClick={save}>{busy && <span className="spinner" />}{isNew ? 'Add and test' : 'Save and test'}</button>}
        {!isNew && <button className="btn btn--outline" onClick={test}>Test connection</button>}
        {!isNew && !n.is_active && !locked && <button className="btn btn--outline" onClick={onActivate}>Activate</button>}
      </>}>
      <div className="form-grid">
        {isNew && <div className="field"><label>Key (e.g. qms-mainnet)</label><input className="input" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} /></div>}
        {isNew && <div className="field"><label>Chain ID</label><input className="input" inputMode="numeric" value={f.chain_id} onChange={(e) => setF({ ...f, chain_id: e.target.value.replace(/\D/g, '') })} /></div>}
        {FIELDS.map(([k, label]) => (
          <div className="field" key={k}><label>{label}</label><input className={`input ${/address|collection/.test(k) ? 'mono' : ''}`} disabled={locked} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value.trim() })} /></div>
        ))}
        <label className="check-row"><input type="checkbox" className="switch" disabled={locked} checked={!!f.is_testnet} onChange={(e) => setF({ ...f, is_testnet: e.target.checked })} />Testnet</label>
      </div>
      {checks && (
        <div className="checks">
          {checks.map((c) => (
            <div key={c.check} className={`check ${c.ok ? '' : 'check--danger'}`}>
              <span className="check__icon">{c.ok ? <IconCheckCircle size={14} /> : <IconXCircle size={14} />}</span>
              <div><b>{c.check.replace(/_/g, ' ')}</b><span>{c.detail}</span></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
