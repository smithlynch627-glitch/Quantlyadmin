import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { SITE_URL, pinnedContracts, NATIVE, BRAND } from '../config';
import { marketAdminAbi } from '../lib/abis';
import { fromWei, short } from '../lib/format';
import { useChainInfo } from '../lib/queries';
import { useAuthedApi } from '../lib/tx';
import { useOwnerAction } from '../lib/useSafe';
import type { Collection } from '../lib/types';
import { CollectionAvatar } from '../components/Art';
import { Alert, Badge, Card, EmptyState, Modal, RowMenu, Segmented, Skeleton, Status, explorer, useDialog, useToast } from '../components/ui';
import { IconBan, IconCheck, IconEdit, IconExternal, IconLayers, IconRefresh, IconSearch, IconTrash, IconPlay } from '../components/Icons';
import { isAcceptedImageLink } from '../lib/mediaLink';

type Row = Collection & { total_supply?: number | null; owners_count?: number | null; volume_wei?: string | null; sales_count?: number | null };
type Filter = 'all' | 'verified' | 'featured' | 'hidden' | 'untradable' | 'imported';
const FILTERS: [Filter, string, (c: Row) => boolean][] = [
  ['all', 'All', () => true], ['verified', 'Verified', (c) => !!c.verified], ['featured', 'Featured', (c) => !!c.featured],
  ['hidden', 'Hidden', (c) => !!c.hidden], ['untradable', 'Not tradable', (c) => !c.tradable], ['imported', 'Imported', (c) => !!c.is_external],
];

export default function Collections({ go }: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const qc = useQueryClient();
  const chain = useChainInfo();
  const { act, busy } = useOwnerAction();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['admin-collections', term], queryFn: () => authed.get<{ collections: Row[] }>('/admin/collections', { q: term }), placeholderData: (p) => p });
  const all = q.data?.collections || [];
  const rows = useMemo(() => all.filter(FILTERS.find((f) => f[0] === filter)![2]), [all, filter]);
  const market = chain.data?.market;

  async function patch(c: Row, body: Record<string, unknown>, done?: string) {
    try {
      await authed.patch(`/admin/collections/${c.address}`, body);
      qc.invalidateQueries({ queryKey: ['admin-collections'] });
      qc.invalidateQueries({ queryKey: ['admin-collection', c.address] });
      if (done) toast(done);
      return true;
    } catch (e: any) {
      toast(e.message, 'error');
      return false;
    }
  }
  async function remove(c: Row) {
    const ok = await dialog.confirm({
      title: `Remove ${c.name} from ${BRAND}?`, tone: 'danger', typeToConfirm: c.address,
      message: 'Its items, listings and activity are deleted from the marketplace database. Nothing changes on-chain, and you can import it again later.',
      confirmLabel: 'Remove collection',
    });
    if (!ok) return;
    try {
      await authed.request('DELETE', `/admin/collections/${c.address}`, { confirm: c.address });
      toast(`${c.name} was removed from the marketplace.`);
      qc.invalidateQueries({ queryKey: ['admin-collections'] });
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function refresh(c: Row) {
    try {
      const r = await authed.post<{ tokens: number }>(`/admin/collections/${c.address}/refresh`);
      toast(`Re-reading ${r.tokens.toLocaleString()} items and their metadata.`, 'info', { title: 'Refreshing' });
    } catch (e: any) { toast(e.message, 'error'); }
  }
  async function trading(c: Row, what: 'block' | 'unblock' | 'enable') {
    if (!market) return;
    const ok = what !== 'block' || await dialog.confirm({
      title: `Block trading of ${c.name}?`, tone: 'warning',
      message: 'Buying and accepting offers stop for this collection. Holders keep their NFTs and can still cancel listings.', confirmLabel: 'Continue',
    });
    if (!ok) return;
    const contract = pinnedContracts().market || market.address;
    if (what === 'enable') await act({ contract, owner: market.owner, abi: marketAdminAbi, functionName: 'setCollectionApproval', args: [c.address, true], label: `Enable trading for ${c.name}` });
    else await act({ contract, owner: market.owner, abi: marketAdminAbi, functionName: 'setCollectionBlocked', args: [c.address, what === 'block'], label: `${what === 'block' ? 'Block' : 'Unblock'} trading of ${c.name}` });
  }

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="input-wrap"><IconSearch size={16} /><input className="input" placeholder="Search by name or 0x address" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search collections" /></div>
        <span className="spacer" />
        <button className="btn btn--sm btn--outline" onClick={() => go('import')}>Import a collection</button>
      </div>
      <div className="chips chips--scroll" role="group" aria-label="Filter">
        {FILTERS.map(([id, label, fn]) => (
          <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span className="chip__count">{all.filter(fn).length}</span></button>
        ))}
      </div>

      <Card flush>
        {q.isLoading ? <div style={{ padding: 20 }}><Skeleton h={260} r={12} /></div> : rows.length === 0 ? (
          <EmptyState icon={<IconLayers size={22} />} title={term ? 'No collection matches' : 'No collections here'} body={term ? 'Try another name or paste the contract address.' : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="dtable dtable--cards">
              <thead><tr><th>Collection</th><th>Items</th><th>Volume</th><th>Verified</th><th>Featured</th><th>Hidden</th><th>Mint page</th><th>Trading</th><th className="shrink" /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.address}>
                    <td className="cell-main">
                      <div className="cell-item">
                        <span className="thumb"><CollectionAvatar collection={c} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="row strong" style={{ gap: 6 }}><span className="ellipsis" style={{ maxWidth: 240 }}>{c.name}</span><Badge official={c.is_official} verified={c.verified} size={14} /></div>
                          <div className="tiny muted row" style={{ gap: 6 }}>{short(c.address)}{c.is_external && <span className="tag">Imported</span>}{c.is_official && <span className="tag tag--ink">Official</span>}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Items" className="num small"><span>{c.total_supply?.toLocaleString() ?? '—'}<span className="muted"> · {c.owners_count?.toLocaleString() ?? 0} owners</span></span></td>
                    <td data-label="Volume" className="num small">{c.volume_wei && c.volume_wei !== '0' ? `${fromWei(c.volume_wei)} ${NATIVE}` : <span className="muted">—</span>}</td>
                    {(['verified', 'featured', 'hidden'] as const).map((f) => (
                      <td key={f} data-label={f[0].toUpperCase() + f.slice(1)}>
                        <input type="checkbox" className="switch" aria-label={`${f} ${c.name}`} checked={Boolean(c[f])} onChange={(e) => patch(c, { [f]: e.target.checked }, `${c.name}: ${f} ${e.target.checked ? 'on' : 'off'}`)} />
                      </td>
                    ))}
                    <td data-label="Mint page">
                      {c.is_external ? <span className="tiny muted">—</span> : <input type="checkbox" className="switch" aria-label={`Mint page ${c.name}`} checked={!c.drop_hidden} onChange={(e) => patch(c, { drop_hidden: !e.target.checked }, `${c.name}: mint page ${e.target.checked ? 'shown' : 'hidden'}`)} />}
                    </td>
                    <td data-label="Trading">
                      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                        {c.tradable ? <Status tone="good">Tradable</Status> : <Status tone="warning">{c.is_external ? 'Not enabled' : 'Blocked'}</Status>}
                        {market && (c.tradable
                          ? <button className="btn btn--xs btn--outline" disabled={!!busy} onClick={() => trading(c, 'block')}><IconBan size={13} />Block</button>
                          : c.is_external
                            ? <button className="btn btn--xs" disabled={!!busy} onClick={() => trading(c, 'enable')}><IconPlay size={12} />Enable</button>
                            : <button className="btn btn--xs btn--outline" disabled={!!busy} onClick={() => trading(c, 'unblock')}><IconCheck size={13} />Unblock</button>)}
                      </div>
                    </td>
                    <td className="right">
                      <RowMenu label={`Actions for ${c.name}`}>
                        <button onClick={() => setEdit(c)}><IconEdit size={16} />Edit details</button>
                        <button onClick={() => refresh(c)}><IconRefresh size={16} />Refresh items & metadata</button>
                        <a href={`${SITE_URL}/collection/${c.slug}`} target="_blank" rel="noreferrer"><IconExternal size={16} />Open on {BRAND}</a>
                        <a href={explorer('address', c.address)} target="_blank" rel="noreferrer"><IconExternal size={16} />Open in explorer</a>
                        {!c.is_official && <><hr /><button className="is-danger" onClick={() => remove(c)}><IconTrash size={16} />Remove from {BRAND}</button></>}
                      </RowMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {market && (
        <Alert title="Trading changes go through the Safe">
          Blocking or enabling trading is an on-chain change on the marketplace contract. When the Safe owns it, the button creates a proposal for the owners to sign in Multisig.
        </Alert>
      )}
      {edit && <EditCollection c={edit} onClose={() => setEdit(null)} onSave={(b) => patch(edit, b, 'Changes saved').then((ok) => { if (ok) setEdit(null); })} />}
    </div>
  );
}

type AboutItem = { label: string; value: string };
type FullCollection = Collection & { telegram?: string | null; about?: string | null; about_image_url?: string | null; about_items?: AboutItem[]; gallery?: string[] };
const toHttp = (u: string) => (u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, '')}` : u.startsWith('ar://') ? `https://arweave.net/${u.slice(5)}` : u);
const MAX_EXTRA = 3;
const LABELS: Record<string, string> = { name: 'Name', slug: 'URL slug', description: 'Short description (collection header)', image_url: 'Logo image link', banner_url: 'Banner image link', twitter: 'X (Twitter)', discord: 'Discord', telegram: 'Telegram', website: 'Website' };

function EditCollection({ c, onClose, onSave }: { c: Collection; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<unknown> | void }) {
  const authed = useAuthedApi();
  const [tab, setTab] = useState<'details' | 'about'>('details');
  const [saving, setSaving] = useState(false);
  const full = useQuery({ queryKey: ['admin-collection', c.address], queryFn: () => authed.get<{ collection: FullCollection }>(`/admin/collections/${c.address}`), retry: false });
  const src: FullCollection = full.data?.collection ?? c;
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [about, setAbout] = useState<{ text: string; image: string; items: AboutItem[] } | null>(null);
  const details = f ?? { name: src.name, slug: src.slug, description: src.description || '', image_url: src.image_url || '', banner_url: src.banner_url || '', twitter: src.twitter || '', discord: src.discord || '', telegram: src.telegram || '', website: src.website || '' };
  const ab = about ?? { text: src.about || '', image: src.about_image_url || '', items: src.about_items || [] };
  const setItems = (items: AboutItem[]) => setAbout({ ...ab, items });
  // Up to three extra images shown beside the logo on the mint page (the creator can also set them in the Studio).
  const [extra, setExtra] = useState<string[] | null>(null);
  const gallery = extra ?? [...(src.gallery || []), '', '', ''].slice(0, MAX_EXTRA);
  const badExtra = gallery.some((x) => x.trim() && !isAcceptedImageLink(x.trim()));
  const validImage = !ab.image || isAcceptedImageLink(ab.image.trim());
  // Logo and banner are links too: checked here for a quick answer, and again by the API when saving.
  const badLinks = (['image_url', 'banner_url'] as const).filter((k) => details[k].trim() && !isAcceptedImageLink(details[k].trim())) as string[];

  async function save() {
    setSaving(true);
    try {
      const nul = (v: string) => (v.trim() ? v.trim() : null);
      await onSave({
        ...details, image_url: nul(details.image_url), banner_url: nul(details.banner_url), twitter: nul(details.twitter), discord: nul(details.discord),
        telegram: nul(details.telegram), website: nul(details.website),
        about: nul(ab.text), about_image_url: nul(ab.image), about_items: ab.items.filter((x) => x.label.trim() && x.value.trim()),
        // only sent when edited, so saving other fields never depends on the extra-images database update
        ...(extra ? { gallery: [...new Set(extra.map((x) => x.trim()).filter(Boolean))] } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={<span className="row" style={{ gap: 10 }}><span className="thumb thumb--sm"><CollectionAvatar collection={c} /></span>Edit {c.name}</span>} width={720}>
      <Segmented label="Section" value={tab} onChange={setTab} options={[['details', 'Details'], ['about', 'About page']]} />
      {full.isLoading ? <Skeleton h={280} r={12} /> : tab === 'details' ? (
        <div className="edit-grid">
          {Object.keys(details).map((k) => (
            <div className={`field ${k === 'description' ? 'edit-grid__wide' : ''}`} key={k}>
              <label htmlFor={`ed-${k}`}>{LABELS[k] || k}</label>
              {k === 'description'
                ? <textarea id={`ed-${k}`} className="textarea" value={details[k]} onChange={(e) => setF({ ...details, [k]: e.target.value })} />
                : <input id={`ed-${k}`} className={`input ${badLinks.includes(k) ? 'input--invalid' : ''}`} value={details[k]} spellCheck={false} onChange={(e) => setF({ ...details, [k]: e.target.value })} />}
              {badLinks.includes(k) && <span className="hint">Use a public link that starts with https://, ipfs:// or ar://</span>}
            </div>
          ))}
          <div className="field edit-grid__wide">
            <span className="label">Extra images on the mint page <span className="muted">(up to {MAX_EXTRA}, any image format)</span></span>
            <ol className="art-list">
              {gallery.map((link, i) => {
                const v = link.trim();
                const ok = !!v && isAcceptedImageLink(v);
                return (
                  <li className="art-row" key={i}>
                    <span className="art-row__n mono">{String(i + 1).padStart(2, '0')}</span>
                    <div className="img-preview img-preview--thumb">{ok && <img key={v} src={toHttp(v)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.15')} />}</div>
                    <input className={`input ${v && !ok ? 'input--invalid' : ''}`} value={link} spellCheck={false} placeholder="https://…  ·  ipfs://…  ·  ar://…" aria-label={`Extra image ${i + 1} link`}
                      onChange={(e) => setExtra(gallery.map((x, j) => (j === i ? e.target.value : x)))} />
                    <div className="art-row__actions">
                      <button className="btn btn--sm btn--ghost" disabled={!link} onClick={() => setExtra(gallery.map((x, j) => (j === i ? '' : x)))}>Clear</button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <span className="hint">{badExtra ? 'Use public links that start with https://, ipfs:// or ar://, with no spaces or unusual characters.' : 'They fan out beside the logo on the mint page. The logo stays first. The creator can also change them in the Studio.'}</span>
          </div>
        </div>
      ) : (
        <div className="about-edit">
          <p className="small muted">Optional. Shown on the collection's About tab. Leave empty to show the short description instead.</p>
          <div className="field">
            <label htmlFor="ab-story">Story</label>
            <textarea id="ab-story" className="textarea" style={{ minHeight: 180 }} maxLength={8000} value={ab.text} placeholder={'Who made it, what it is about, what holders get…\n\nLeave a blank line between paragraphs.'} onChange={(e) => setAbout({ ...ab, text: e.target.value })} />
            <span className="hint">{ab.text.length.toLocaleString()} / 8,000 · blank line = new paragraph</span>
          </div>
          <div className="field">
            <label htmlFor="ab-img">Feature image URL</label>
            <div className="about-edit__image">
              <div className="about-edit__preview">{ab.image && validImage ? <img src={toHttp(ab.image.trim())} alt="" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} /> : <span className="tiny muted">16:9 · 1600×900 recommended</span>}</div>
              <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                <input id="ab-img" className={`input ${validImage ? '' : 'input--invalid'}`} value={ab.image} placeholder="https://…  ·  ipfs://…  ·  ar://…" onChange={(e) => setAbout({ ...ab, image: e.target.value })} />
                <span className="hint">{validImage ? 'Falls back to the banner when empty.' : 'Use a public link that starts with https://, ipfs:// or ar://, with no spaces or unusual characters.'}</span>
              </div>
            </div>
          </div>
          <div className="field">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label>Details ({ab.items.length}/12)</label>
              <button className="btn btn--xs btn--outline" disabled={ab.items.length >= 12} onClick={() => setItems([...ab.items, { label: '', value: '' }])}>Add row</button>
            </div>
            {ab.items.length === 0 && <p className="tiny muted">Examples: Artist · Jane Kim, Utility · Holder-only events, Roadmap · Season 2 in Q1.</p>}
            <div className="about-rows">
              {ab.items.map((it, i) => (
                <div className="about-row" key={i}>
                  <input className="input" maxLength={40} placeholder="Label" value={it.label} onChange={(e) => setItems(ab.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <input className="input" maxLength={300} placeholder="Value" value={it.value} onChange={(e) => setItems(ab.items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <div className="about-row__tools">
                    <button className="icon-btn icon-btn--sm" aria-label="Move up" disabled={i === 0} onClick={() => { const a = [...ab.items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setItems(a); }}>↑</button>
                    <button className="icon-btn icon-btn--sm" aria-label="Move down" disabled={i === ab.items.length - 1} onClick={() => { const a = [...ab.items]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setItems(a); }}>↓</button>
                    <button className="icon-btn icon-btn--sm" aria-label="Remove row" onClick={() => setItems(ab.items.filter((_, j) => j !== i))}>×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <a className="link small" href={`${SITE_URL}/collection/${c.slug}?tab=about`} target="_blank" rel="noreferrer">Open the live About tab ↗</a>
        </div>
      )}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn--outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 2 }} disabled={saving || !validImage || badExtra || badLinks.length > 0 || full.isLoading} onClick={save}>{saving && <span className="spinner" />}Save changes</button>
      </div>
    </Modal>
  );
}
