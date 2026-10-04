import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAddress } from 'viem';
import { useAccount } from 'wagmi';
import type { PageProps } from '../AdminApp';
import { timeAgo } from '../lib/format';
import { useAuthedApi } from '../lib/tx';
import { useSafeInfo } from '../lib/useSafe';
import { Address, Card, EmptyState, Segmented, Skeleton, useDialog, useToast } from '../components/ui';
import { IconKey, IconTrash, IconUsers } from '../components/Icons';

type Member = { address: string; role: 'owner' | 'admin' | 'support'; added_by: string; created_at?: string; root?: boolean };
const ROLE_TEXT = { support: 'Support tickets only', admin: 'Collections, treasury, multisig, contracts, log', owner: 'Everything, including team and network' };

export default function Team(_: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const { address } = useAccount();
  const safe = useSafeInfo();
  const q = useQuery({ queryKey: ['admin-team'], queryFn: () => authed.get<{ admins: Member[] }>('/admin/admins') });
  const [addr, setAddr] = useState('');
  const [role, setRole] = useState<Member['role']>('support');
  const a = addr.trim().toLowerCase();
  async function save() {
    const ok = await dialog.confirm({ title: `Give ${role} access?`, message: <><span className="mono">{a}</span><span>{ROLE_TEXT[role]}.</span></>, tone: role === 'owner' ? 'warning' : 'default', confirmLabel: 'Give access' });
    if (!ok) return;
    try { await authed.post('/admin/admins', { address: a, role }); toast('Team member saved'); setAddr(''); q.refetch(); } catch (e: any) { toast(e.message, 'error'); }
  }
  async function remove(m: Member) {
    const ok = await dialog.confirm({ title: 'Remove access?', tone: 'danger', message: <>This wallet can no longer open the admin panel.<span className="mono">{m.address}</span></>, confirmLabel: 'Remove' });
    if (!ok) return;
    try { await authed.del(`/admin/admins/${m.address}`); toast('Access removed'); q.refetch(); } catch (e: any) { toast(e.message, 'error'); }
  }
  return (
    <div className="stack-lg">
      <Card title="Add a team member" sub="Access is checked by the API on every request">
        <div className="field"><label htmlFor="tm-addr">Wallet address</label><input id="tm-addr" className={`input mono ${addr && !isAddress(a) ? 'input--invalid' : ''}`} placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} /></div>
        <div className="field"><label>Role</label><Segmented label="Role" value={role} onChange={setRole} options={[['support', 'Support'], ['admin', 'Admin'], ['owner', 'Owner']]} /><span className="hint">{ROLE_TEXT[role]}.</span></div>
        <div><button className="btn" disabled={!isAddress(a)} onClick={save}>Save</button></div>
      </Card>
      <Card title="Team" flush>
        {!q.data ? <div style={{ padding: 20 }}><Skeleton h={160} /></div> : q.data.admins.length === 0 ? <EmptyState icon={<IconUsers size={22} />} title="No team members" /> : (
          <div className="table-wrap">
            <table className="dtable dtable--cards">
              <thead><tr><th>Wallet</th><th>Role</th><th>Added</th><th className="shrink" /></tr></thead>
              <tbody>{q.data.admins.map((m) => (
                <tr key={m.address}>
                  <td className="cell-main" data-label="Wallet"><div className="row" style={{ gap: 8 }}><Address value={m.address} label={m.address === address?.toLowerCase() ? 'You' : null} />{safe.data?.owners.includes(m.address) && <span className="tag" title="Safe owner"><IconKey size={12} />&nbsp;Safe owner</span>}</div></td>
                  <td data-label="Role"><span className={`tag ${m.role === 'owner' ? 'tag--ink' : ''}`}>{m.role}</span></td>
                  <td data-label="Added" className="small soft">{m.root ? 'Server setting (ADMIN_ADDRESSES)' : <>by <Address value={m.added_by} link={false} copy={false} />{m.created_at ? ` · ${timeAgo(m.created_at, 'en')}` : ''}</>}</td>
                  <td className="right">{!m.root && m.address !== address?.toLowerCase() && <button className="icon-btn icon-btn--sm" aria-label={`Remove ${m.address}`} onClick={() => remove(m)}><IconTrash size={15} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
