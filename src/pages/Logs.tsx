import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { short } from '../lib/format';
import { useAuthedApi } from '../lib/tx';
import { useSafeInfo } from '../lib/useSafe';
import { Address, Card, EmptyState, Skeleton } from '../components/ui';
import {
  IconBan, IconDownload, IconEdit, IconLayers, IconLifebuoy, IconLogs, IconNetwork, IconPen, IconSearch, IconSettings, IconShield, IconTrash, IconUsers, IconZap, IconChevronRight,
} from '../components/Icons';

export interface AuditEntry { id: number; actor: string; action: string; target: string | null; details: Record<string, any>; created_at: string }
type Cat = '' | 'collection' | 'safe' | 'settings' | 'network' | 'admin' | 'ticket' | 'user';
const CATS: [Cat, string][] = [['', 'All'], ['safe', 'Multisig'], ['collection', 'Collections'], ['settings', 'Site settings'], ['network', 'Network'], ['admin', 'Team'], ['ticket', 'Support'], ['user', 'Users']];

export function actionIcon(action: string) {
  const [cat, verb] = action.split('.');
  if (cat === 'safe') return verb === 'sign' ? <IconPen size={15} /> : verb === 'execute' ? <IconZap size={15} /> : verb === 'discard' ? <IconTrash size={15} /> : <IconShield size={15} />;
  if (cat === 'collection') return verb === 'remove' ? <IconTrash size={15} /> : verb === 'update' ? <IconEdit size={15} /> : verb === 'import' ? <IconDownload size={15} /> : <IconLayers size={15} />;
  if (cat === 'settings') return <IconSettings size={15} />;
  if (cat === 'network') return <IconNetwork size={15} />;
  if (cat === 'admin') return <IconUsers size={15} />;
  if (cat === 'ticket') return <IconLifebuoy size={15} />;
  if (cat === 'user') return <IconBan size={15} />;
  return <IconLogs size={15} />;
}

const onOff = (v: unknown) => (v ? 'on' : 'off');
export function actionTitle(e: AuditEntry): string {
  const d = e.details || {};
  switch (e.action) {
    case 'safe.propose': return `Proposed: ${d.label || d.fn}`;
    case 'safe.sign': return `Signed: ${d.label || `proposal #${d.id}`}`;
    case 'safe.execute': return `${d.ok === false ? 'Execution failed' : 'Executed'}: ${d.label || `proposal #${d.id}`}`;
    case 'safe.discard': return `Removed proposal #${d.id}${d.label ? ` (${d.label})` : ''}`;
    case 'collection.update': {
      const parts = Object.entries(d).map(([k, v]) => (typeof v === 'boolean' ? `${k.replace('_', ' ')} ${k === 'drop_hidden' ? (v ? 'hidden' : 'shown') : onOff(v)}` : k.replace(/_/g, ' '))).slice(0, 4);
      return `Collection edited: ${parts.join(', ') || 'details'}`;
    }
    case 'collection.remove': return `Removed collection ${d.name || ''}`.trim();
    case 'collection.refresh': return 'Refreshed a collection';
    case 'collection.import': return `Imported a collection${d.tokens ? ` (${d.tokens} items)` : ''}`;
    case 'settings.update': return 'Updated community links';
    case 'admin.set': return `Gave ${d.role} access`;
    case 'admin.remove': return 'Removed a team member';
    case 'user.ban': return 'Banned a user';
    case 'user.unban': return 'Unbanned a user';
    case 'ticket.reply': return `Replied to a ticket${d.status ? ` (${d.status})` : ''}`;
    case 'ticket.update': return 'Updated a ticket';
    case 'ticket.view': return 'Opened a ticket';
    default: return e.action.replace('.', ': ').replace(/_/g, ' ');
  }
}

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export default function Logs(_: PageProps) {
  const authed = useAuthedApi();
  const safe = useSafeInfo();
  const [cat, setCat] = useState<Cat>('');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = useInfiniteQuery({
    queryKey: ['admin-audit', cat, term],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => authed.get<{ entries: AuditEntry[]; more: boolean }>('/admin/audit', { category: cat, q: term, before: pageParam || undefined, limit: 60 }),
    getNextPageParam: (last) => (last.more && last.entries.length ? last.entries[last.entries.length - 1].id : undefined),
  });
  const entries = useMemo(() => (q.data?.pages || []).flatMap((p) => p.entries), [q.data]);
  const groups = useMemo(() => {
    const g: { key: string; label: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const k = dayKey(e.created_at);
      if (!g.length || g[g.length - 1].key !== k) g.push({ key: k, label: dayLabel(e.created_at), items: [] });
      g[g.length - 1].items.push(e);
    }
    return g;
  }, [entries]);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['time', 'actor', 'action', 'summary', 'target', 'details'], ...entries.map((e) => [e.created_at, e.actor, e.action, actionTitle(e), e.target, JSON.stringify(e.details)])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quantly-admin-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="input-wrap"><IconSearch size={16} /><input className="input" placeholder="Search wallet, address, action or detail" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search the log" /></div>
        <span className="spacer" />
        <button className="btn btn--sm btn--outline" disabled={!entries.length} onClick={exportCsv}><IconDownload size={15} />Export CSV</button>
      </div>
      <div className="chips chips--scroll" role="group" aria-label="Category">
        {CATS.map(([id, label]) => <button key={id || 'all'} className="chip" aria-pressed={cat === id} onClick={() => setCat(id)}>{label}</button>)}
      </div>
      <Card flush>
        {q.isLoading ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : entries.length === 0 ? (
          <EmptyState icon={<IconLogs size={22} />} title="No log entries" body={term || cat ? 'Nothing matches these filters.' : 'Admin actions will appear here.'} />
        ) : (
          <div>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="log-day">{g.label}</div>
                {g.items.map((e) => (
                  <div key={e.id} className="log">
                    <span className="log__icon">{actionIcon(e.action)}</span>
                    <div className="log__main">
                      <button className="log__title" style={{ all: 'unset', cursor: 'pointer', fontWeight: 640, overflowWrap: 'anywhere' }} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {actionTitle(e)} <IconChevronRight size={13} style={{ transform: open === e.id ? 'rotate(90deg)' : undefined, transition: 'transform .15s', verticalAlign: '-2px' }} />
                      </button>
                      <div className="log__meta">
                        <span className="row" style={{ gap: 4 }}>by <Address value={e.actor} link={false} /></span>
                        {e.target && <span className="row" style={{ gap: 4 }}>on {/^0x[0-9a-f]{40}$/i.test(e.target) ? <Address value={e.target} label={e.target === safe.data?.safe ? 'Safe' : null} /> : <span className="mono">{e.target.length > 24 ? short(e.target) : e.target}</span>}</span>}
                        <span className="tag">{e.action}</span>
                      </div>
                      {open === e.id && <pre>{JSON.stringify(e.details, null, 2)}</pre>}
                    </div>
                    <span className="log__time">{new Date(e.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            ))}
            {q.hasNextPage && (
              <div style={{ padding: 16, display: 'grid', placeItems: 'center', borderTop: '1px solid var(--line)' }}>
                <button className="btn btn--sm btn--outline" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage && <span className="spinner" />}Load older entries</button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
