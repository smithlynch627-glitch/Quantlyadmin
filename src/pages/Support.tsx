import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { SITE_URL } from '../config';
import { dateTime, short, timeAgo } from '../lib/format';
import { useAuthedApi } from '../lib/tx';
import { Address, Card, EmptyState, Skeleton, Status, useToast } from '../components/ui';
import { IconLifebuoy, IconSend } from '../components/Icons';

const STATUSES = ['open', 'waiting', 'resolved', 'closed'] as const;
const tone = (s: string) => (s === 'open' ? 'warning' : s === 'resolved' ? 'good' : 'neutral') as 'warning' | 'good' | 'neutral';
const prio = (p: string) => (p === 'urgent' ? 'danger' : p === 'high' ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';

export default function Support(_: PageProps) {
  const authed = useAuthedApi();
  const [status, setStatus] = useState<string>('open');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-tickets', status], queryFn: () => authed.get<{ tickets: any[] }>('/admin/tickets', { status }), refetchInterval: 30_000 });
  if (open) return <Ticket id={open} onBack={() => { setOpen(null); q.refetch(); }} />;
  return (
    <div className="stack-lg">
      <div className="chips chips--scroll" role="group" aria-label="Status">
        {[...STATUSES, ''].map((s) => <button key={s || 'all'} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? s[0].toUpperCase() + s.slice(1) : 'All'}</button>)}
      </div>
      <Card flush>
        {!q.data ? <div style={{ padding: 20 }}><Skeleton h={200} /></div> : q.data.tickets.length === 0 ? <EmptyState icon={<IconLifebuoy size={22} />} title="No tickets" body={status ? `Nothing is ${status} right now.` : undefined} /> : (
          <div className="table-wrap">
            <table className="dtable dtable--cards">
              <thead><tr><th>Ticket</th><th>From</th><th>Topic</th><th>Priority</th><th>Status</th><th className="right">Updated</th></tr></thead>
              <tbody>
                {q.data.tickets.map((x) => (
                  <tr key={x.id} className="is-clickable" onClick={() => setOpen(x.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(x.id)}>
                    <td className="cell-main" data-label="Ticket"><div className="strong">{x.subject}</div><div className="tiny muted">{x.ref} · {x.messages} message{x.messages === 1 ? '' : 's'}</div></td>
                    <td data-label="From"><Address value={x.address} link={false} /></td>
                    <td data-label="Topic" className="small">{x.category}</td>
                    <td data-label="Priority"><Status tone={prio(x.priority)}>{x.priority}</Status></td>
                    <td data-label="Status"><Status tone={tone(x.status)}>{x.status}</Status></td>
                    <td data-label="Updated" className="right small soft nowrap">{timeAgo(x.last_message_at, 'en')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Ticket({ id, onBack }: { id: string; onBack: () => void }) {
  const authed = useAuthedApi();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('waiting');
  const [sending, setSending] = useState(false);
  const q = useQuery({ queryKey: ['admin-ticket', id], queryFn: () => authed.get<{ ticket: any; messages: any[] }>(`/admin/tickets/${id}`) });
  async function send() {
    setSending(true);
    try { await authed.post(`/admin/tickets/${id}/reply`, { body: reply, status }); setReply(''); toast('Reply sent'); q.refetch(); } catch (e: any) { toast(e.message, 'error'); } finally { setSending(false); }
  }
  async function setField(body: Record<string, string>) {
    await authed.patch(`/admin/tickets/${id}`, body).then(() => toast('Ticket updated')).catch((e) => toast(e.message, 'error'));
    q.refetch();
  }
  if (!q.data) return <Skeleton h={300} r={18} />;
  const t = q.data.ticket;
  return (
    <div className="grid-main">
      <Card title={`${t.ref}: ${t.subject}`} right={<button className="btn btn--sm btn--ghost" onClick={onBack}>← All tickets</button>}>
        <div className="thread">
          {q.data.messages.map((m) => (
            <div key={m.id} className={`msg ${m.is_staff ? 'is-staff' : ''}`}>
              <div className="tiny" style={{ opacity: 0.7, marginBottom: 4 }}>{m.is_staff ? `Staff ${short(m.author)}` : 'User'} · {dateTime(m.created_at, 'en')}</div>
              {m.body}
            </div>
          ))}
        </div>
        <div className="field"><label htmlFor="reply">Reply</label><textarea id="reply" className="textarea" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write to the user" /></div>
        <div className="row-wrap">
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status after reply">{['waiting', 'resolved', 'closed', 'open'].map((s) => <option key={s} value={s}>Then mark: {s}</option>)}</select>
          <button className="btn" disabled={!reply.trim() || sending} onClick={send}>{sending ? <span className="spinner" /> : <IconSend size={15} />}Send reply</button>
        </div>
      </Card>
      <Card title="Details">
        <dl className="kv">
          <div><dt>From</dt><dd><a className="link mono small" href={`${SITE_URL}/profile/${t.address}`} target="_blank" rel="noreferrer">{short(t.address)}</a></dd></div>
          <div><dt>Contact (decrypted)</dt><dd>{t.contact || '—'}</dd></div>
          <div><dt>Topic</dt><dd>{t.category}</dd></div>
          {t.tx_hash && <div><dt>Transaction</dt><dd><Address value={t.tx_hash} kind="tx" /></dd></div>}
          {t.collection && <div><dt>Collection</dt><dd><Address value={t.collection} />{t.token_id ? ` #${t.token_id}` : ''}</dd></div>}
        </dl>
        <div className="field"><label>Status</label><select className="select" value={t.status} onChange={(e) => setField({ status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Priority</label><select className="select" value={t.priority} onChange={(e) => setField({ priority: e.target.value })}>{['low', 'normal', 'high', 'urgent'].map((s) => <option key={s}>{s}</option>)}</select></div>
      </Card>
    </div>
  );
}
