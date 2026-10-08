import { useEffect, useMemo, useState } from 'react';
import type { PageProps } from '../AdminApp';
import { SITE_URL } from '../config';
import { dateTime, num, short, timeAgo } from '../lib/format';
import { useApiKey, useApiKeyActions, useApiKeys, type KeySettings, type KeyStatus, type KeyTier } from '../lib/apiKeys';
import { ColumnChart } from '../components/Chart';
import { Address, Alert, Card, EmptyState, LoadError, Modal, Segmented, Skeleton, Status, type Tone, useDialog, useToast } from '../components/ui';
import { IconBan, IconCheck, IconExternal, IconKey, IconPause, IconPlay, IconSearch, IconTrash } from '../components/Icons';

const FILTERS: [KeyStatus | '', string][] = [['pending', 'Pending'], ['active', 'Active'], ['paused', 'Paused'], ['rejected', 'Rejected'], ['revoked', 'Revoked'], ['', 'All']];
const LABEL: Record<KeyStatus, string> = { pending: 'Pending', active: 'Active', paused: 'Paused', rejected: 'Rejected', revoked: 'Revoked' };
const TONE: Record<KeyStatus, Tone> = { pending: 'warning', active: 'good', paused: 'neutral', rejected: 'neutral', revoked: 'danger' };
const KeyStatusPill = ({ s }: { s: KeyStatus }) => <Status tone={TONE[s]} icon={s === 'paused' ? <IconPause size={13} /> : undefined}>{LABEL[s]}</Status>;

export default function ApiKeys(_: PageProps) {
  const [status, setStatus] = useState<KeyStatus | ''>('pending');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const q = useApiKeys(status, term);
  const rows = q.data?.keys || [];
  const counts = q.data?.counts;

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="input-wrap"><IconSearch size={16} /><input className="input" placeholder="Search project, wallet or key prefix" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search API keys" /></div>
      </div>
      <div className="chips chips--scroll" role="group" aria-label="Status">
        {FILTERS.map(([id, label]) => (
          <button key={id || 'all'} className="chip" aria-pressed={status === id} onClick={() => setStatus(id)}>
            {label}{counts && <span className="chip__count">{counts[id || 'all']}</span>}
          </button>
        ))}
      </div>

      {q.error && !q.data ? <LoadError error={q.error} what="API keys" retry={() => q.refetch()} /> : (
        <Card flush>
          {q.isLoading ? <div style={{ padding: 20 }}><Skeleton h={220} r={12} /></div> : rows.length === 0 ? (
            <EmptyState icon={<IconKey size={22} />} title={term ? 'Nothing matches' : status ? `No ${LABEL[status].toLowerCase()} keys` : 'No API keys yet'}
              body={term ? 'Search by project name, wallet address or key prefix (qk_live_…).' : status === 'pending' ? 'New key requests from the website appear here.' : undefined} />
          ) : (
            <div className="table-wrap">
              <table className="dtable dtable--cards">
                <thead><tr><th>Project</th><th>Wallet</th><th>Status</th><th>Limits</th><th className="right">Today</th><th className="right">Requested</th></tr></thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.id} className="is-clickable" tabIndex={0} onClick={() => setOpen(k.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(k.id)}>
                      <td className="cell-main" data-label="Project">
                        <div className="row strong" style={{ gap: 6 }}><span className="ellipsis" style={{ maxWidth: 260 }}>{k.project}</span>{k.tier === 'partner' && <span className="tag tag--ink">Partner</span>}</div>
                        <div className="tiny muted">{k.prefix ? <span className="mono">{k.prefix}…</span> : k.status === 'active' ? 'Approved, not revealed yet' : k.status === 'pending' ? 'Waiting for review' : 'No key was created'}</div>
                      </td>
                      <td data-label="Wallet"><Address value={k.address} link={false} /></td>
                      <td data-label="Status"><KeyStatusPill s={k.status} /></td>
                      <td data-label="Limits" className="small num nowrap">{num(k.per_minute)}/min · {num(k.per_day)}/day</td>
                      <td data-label="Today" className="right small num">{num(k.usage_today)}</td>
                      <td data-label="Requested" className="right small soft nowrap">{timeAgo(k.created_at, 'en')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <Alert title="Keys stay with their owner">
        Approving a request lets its wallet reveal the key once on the website. The server keeps only a hash and the prefix, so nobody here can see or recover a key. Owners can rotate or revoke their own keys at any time.
      </Alert>
      {open && <KeyDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Form = { per_minute: string; per_day: string; tier: KeyTier; note: string };

function limitError(f: Form, s: KeySettings): string | null {
  const ok = (v: string, max: number) => /^\d{1,7}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= max;
  if (!ok(f.per_minute, s.caps.per_minute)) return `Requests per minute: 1 to ${num(s.caps.per_minute)}`;
  if (!ok(f.per_day, s.caps.per_day)) return `Requests per day: 1 to ${num(s.caps.per_day)}`;
  if (f.note.length > 2000) return 'The note can be at most 2,000 characters';
  return null;
}

function KeyDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiKey(id);
  const actions = useApiKeyActions();
  const toast = useToast();
  const dialog = useDialog();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const k = q.data?.key;
  const usage = useMemo(() => (q.data?.usage || []).map((u) => ({ label: u.day, value: u.requests })), [q.data?.usage]);

  if (q.error) return <Modal open onClose={onClose} title="API key"><LoadError error={q.error} what="this key" retry={() => q.refetch()} /></Modal>;
  if (!k || !q.data) return <Modal open onClose={onClose} title="API key"><Skeleton h={320} r={12} /></Modal>;
  const settings: KeySettings = q.data;
  const pending = k.status === 'pending';
  const open = k.status === 'active' || k.status === 'paused';
  // A pending request is pre-filled with today's defaults; other keys show their own limits.
  const f: Form = form ?? {
    per_minute: String(pending ? settings.defaults.per_minute : k.per_minute),
    per_day: String(pending ? settings.defaults.per_day : k.per_day),
    tier: k.tier,
    note: k.admin_note || '',
  };
  const err = limitError(f, settings);
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });
  const total30 = usage.reduce((a, u) => a + u.value, 0);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await fn();
      toast(done);
      setForm(null);
      await q.refetch();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }
  const limits = () => ({ per_minute: Number(f.per_minute), per_day: Number(f.per_day), tier: f.tier, note: f.note.trim() });
  const approve = () => run('approve', () => actions.approve(k.id, limits()), `${k.project} approved. The owner can now reveal the key on the website.`);
  async function reject() {
    const reason = await dialog.prompt({
      title: `Reject ${k!.project}?`, tone: 'warning', label: 'Reason (shown to the requester)', placeholder: 'For example: please describe what the bot will do in more detail.',
      validate: (v) => (v.trim().length < 3 ? 'Write at least 3 characters' : v.trim().length > 500 ? 'At most 500 characters' : null), confirmLabel: 'Reject request',
    });
    if (reason) await run('reject', () => actions.reject(k!.id, reason), 'Request rejected');
  }
  async function revoke() {
    const ok = await dialog.confirm({
      title: `Revoke ${k!.project}?`, tone: 'danger', confirmLabel: 'Revoke key',
      message: 'The key stops working right away and can never be turned back on. The owner would have to request a new key.',
      details: [['Wallet', short(k!.address)], ['Key', k!.prefix ? `${k!.prefix}…` : 'not revealed yet']],
    });
    if (ok) await run('revoke', () => actions.move(k!.id, 'revoke'), 'Key revoked');
  }
  const save = () => run('save', () => actions.update(k.id, open || pending ? limits() : { note: f.note.trim() }), 'Changes saved');
  const toggle = () => run('toggle', () => actions.move(k.id, k.status === 'paused' ? 'resume' : 'pause'), k.status === 'paused' ? 'Key resumed' : 'Key paused');

  return (
    <Modal open onClose={onClose} width={760} title={<span className="row" style={{ gap: 10 }}><IconKey size={18} /><span className="ellipsis">{k.project}</span><KeyStatusPill s={k.status} /></span>}>
      {pending && (
        <Alert tone="warning" title="Waiting for review">
          Approving does not create a key yet. The owner reveals it once on the website; you will only ever see its prefix here.
        </Alert>
      )}
      {k.status === 'rejected' && k.reject_reason && <Alert title="Rejected">{k.reject_reason}</Alert>}

      <div className="grid-2">
        <dl className="kv">
          <div><dt>Wallet</dt><dd><a className="link mono small" href={`${SITE_URL}/profile/${k.address}`} target="_blank" rel="noreferrer">{short(k.address)}</a></dd></div>
          <div><dt>Website</dt><dd>{k.website ? <a className="link small row" style={{ gap: 4, justifyContent: 'flex-end' }} href={k.website} target="_blank" rel="noreferrer noopener">{k.website.replace(/^https:\/\//, '').slice(0, 40)}<IconExternal size={13} /></a> : '—'}</dd></div>
          <div><dt>Contact (decrypted)</dt><dd className="small">{k.contact || (k.contact_unreadable ? 'Cannot be decrypted (encryption key changed?)' : '—')}</dd></div>
          <div><dt>Requested</dt><dd className="small">{dateTime(k.created_at, 'en')}</dd></div>
        </dl>
        <dl className="kv">
          <div><dt>Key</dt><dd className="small">{k.prefix ? <span className="mono">{k.prefix}…</span> : k.status === 'active' ? 'Not revealed yet' : '—'}</dd></div>
          <div><dt>{k.status === 'rejected' ? 'Rejected' : 'Approved'}</dt><dd className="small">{k.approved_at ? <>{dateTime(k.approved_at, 'en')} · <Address value={k.approved_by} link={false} copy={false} /></> : k.rejected_at ? <>{dateTime(k.rejected_at, 'en')} · <Address value={k.rejected_by} link={false} copy={false} /></> : '—'}</dd></div>
          <div><dt>Revealed / rotated</dt><dd className="small">{k.revealed_at ? dateTime(k.revealed_at, 'en') : '—'}{k.rotated_at ? ` · rotated ${timeAgo(k.rotated_at, 'en')}` : ''}</dd></div>
          <div><dt>{k.revoked_at ? 'Revoked' : 'Last used'}</dt><dd className="small">{k.revoked_at ? <>{dateTime(k.revoked_at, 'en')} · {k.revoked_by === k.address ? 'by the owner' : <Address value={k.revoked_by} link={false} copy={false} />}</> : k.last_used_at ? timeAgo(k.last_used_at, 'en') : 'Never'}</dd></div>
        </dl>
      </div>

      <div className="field">
        <span className="label">What it is for</span>
        <div className="msg" style={{ maxWidth: '100%' }}>{k.use_case}</div>
      </div>

      {!pending && k.status !== 'rejected' && (
        <div className="field">
          <span className="label row" style={{ justifyContent: 'space-between' }}><span>Requests per day, last 30 days (UTC)</span><span className="muted">today {num(k.usage_today)} · 30 days {num(total30)}</span></span>
          {total30 > 0
            ? <ColumnChart data={usage} format={(n) => num(Math.round(n))} height={170} label="Requests per day for this key" />
            : <div className="tiny muted">No requests in the last 30 days.</div>}
        </div>
      )}

      <div className="edit-grid">
        {(pending || open) && (
          <>
            <div className="field">
              <label htmlFor="ak-min">Requests per minute</label>
              <input id="ak-min" className="input num" inputMode="numeric" value={f.per_minute} onChange={(e) => set({ per_minute: e.target.value })} />
              <span className="hint">Up to {num(settings.caps.per_minute)}. Default {num(settings.defaults.per_minute)}.</span>
            </div>
            <div className="field">
              <label htmlFor="ak-day">Requests per day (UTC)</label>
              <input id="ak-day" className="input num" inputMode="numeric" value={f.per_day} onChange={(e) => set({ per_day: e.target.value })} />
              <span className="hint">Up to {num(settings.caps.per_day)}. Default {num(settings.defaults.per_day)}.</span>
            </div>
            <div className="field edit-grid__wide">
              <span className="label">Tier</span>
              <div><Segmented label="Tier" value={f.tier} onChange={(tier) => set({ tier })} options={[['free', 'Free'], ['partner', 'Partner']]} /></div>
            </div>
          </>
        )}
        <div className="field edit-grid__wide">
          <label htmlFor="ak-note">Internal note <span className="muted">(only admins see it)</span></label>
          <textarea id="ak-note" className="textarea" style={{ minHeight: 70 }} maxLength={2000} value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      </div>
      {err && form && <span className="hint" style={{ color: 'var(--bad)' }}>{err}</span>}

      {pending ? (
        <div className="row-wrap">
          <button className="btn btn--outline" disabled={!!busy} onClick={reject}><IconBan size={15} />Reject</button>
          <span className="spacer" />
          <button className="btn" disabled={!!busy || !!err} onClick={approve}>{busy === 'approve' ? <span className="spinner" /> : <IconCheck size={15} />}Approve with these limits</button>
        </div>
      ) : (
        <div className="row-wrap">
          {open && <button className="btn btn--outline btn--sm" disabled={!!busy} onClick={toggle}>{busy === 'toggle' ? <span className="spinner" /> : k.status === 'paused' ? <IconPlay size={13} /> : <IconPause size={14} />}{k.status === 'paused' ? 'Resume' : 'Pause'}</button>}
          {open && <button className="btn btn--danger btn--sm" disabled={!!busy} onClick={revoke}><IconTrash size={14} />Revoke</button>}
          <span className="spacer" />
          <button className="btn btn--sm" disabled={!!busy || !form || !!err} onClick={save}>{busy === 'save' && <span className="spinner" />}Save changes</button>
        </div>
      )}
    </Modal>
  );
}

