import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAddress } from 'viem';
import type { PageProps } from '../AdminApp';
import { useAuthedApi } from '../lib/tx';
import { Address, Alert, Card, EmptyState, Skeleton, useToast } from '../components/ui';
import { IconDownload, IconRefresh, IconSearch } from '../components/Icons';

type Found = { address: string; name: string; symbol: string; holders: number; totalSupply: string | null; imported: boolean };

export default function Import({ go }: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const [pages, setPages] = useState<(Record<string, unknown> | null)[]>([null]);
  const page = pages[pages.length - 1];
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-discover', page], queryFn: () => authed.get<{ items: Found[]; next: Record<string, unknown> | null }>('/admin/discover', page ? { page: JSON.stringify(page) } : undefined), retry: false });
  async function doImport(address: string) {
    setBusy(address);
    try {
      const r = await authed.post<{ tokens: number; tradable: boolean; warning?: string | null }>('/admin/import', { address });
      toast(`${r.tokens.toLocaleString()} items imported.${r.tradable ? '' : ' Enable trading in Collections to allow listings.'}`, 'success', { title: 'Collection imported' });
      if (r.warning) toast(r.warning, 'warning');
      q.refetch();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }
  const m = manual.trim().toLowerCase();
  return (
    <div className="stack-lg">
      <Card title="Import by contract address" sub="Any ERC-721 collection on this network">
        <div className="toolbar">
          <div className="input-wrap" style={{ maxWidth: 560 }}><IconSearch size={16} /><input className="input mono" placeholder="0x… collection contract" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Collection address" /></div>
          <button className="btn" disabled={!isAddress(m) || !!busy} onClick={() => doImport(m)}>{busy === m ? <span className="spinner" /> : <IconDownload size={16} />}Import</button>
        </div>
        <Alert title="How imports work">
          Imported collections show on the marketplace right away. Trading needs one on-chain approval in Collections (a Safe proposal), which protects buyers from fake contracts.
          Large collections import their first 5,000 items (about a minute); later transfers are followed automatically.
        </Alert>
      </Card>
      <Card title="ERC-721 collections on this network" sub="From the block explorer" flush
        right={<button className="btn btn--sm btn--outline" onClick={() => go('collections')}>View imported</button>}>
        {q.isError ? <div style={{ padding: 20 }}><Alert tone="warning" title="The explorer did not answer">{(q.error as Error).message}</Alert></div> : !q.data ? <div style={{ padding: 20 }}><Skeleton h={260} /></div> : q.data.items.length === 0 ? <EmptyState title="Nothing found" /> : (
          <>
            <div className="table-wrap">
              <table className="dtable dtable--cards">
                <thead><tr><th>Collection</th><th>Contract</th><th className="right">Holders</th><th className="right">Supply</th><th className="shrink" /></tr></thead>
                <tbody>
                  {q.data.items.map((it) => (
                    <tr key={it.address}>
                      <td className="cell-main" data-label="Collection"><span className="strong">{it.name || 'Unnamed'}</span> <span className="muted small">{it.symbol}</span>{it.imported && <span className="tag" style={{ marginLeft: 8 }}>On Quantly</span>}</td>
                      <td data-label="Contract"><Address value={it.address} /></td>
                      <td data-label="Holders" className="right num">{it.holders.toLocaleString()}</td>
                      <td data-label="Supply" className="right num">{it.totalSupply ? Number(it.totalSupply).toLocaleString() : '—'}</td>
                      <td className="right">
                        <button className={`btn btn--xs ${it.imported ? 'btn--outline' : ''}`} disabled={!!busy} onClick={() => doImport(it.address)}>
                          {busy === it.address ? <span className="spinner" /> : it.imported ? <IconRefresh size={13} /> : <IconDownload size={13} />}{it.imported ? 'Re-sync' : 'Import'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card__foot">
              <button className="btn btn--sm btn--outline" disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))}>Previous</button>
              <button className="btn btn--sm btn--outline" disabled={!q.data.next} onClick={() => setPages([...pages, q.data!.next])}>Next</button>
              <span className="small muted">Page {pages.length}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
