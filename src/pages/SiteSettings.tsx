import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { SITE_URL } from '../config';
import { useAuthedApi } from '../lib/tx';
import { Card, Skeleton, useToast } from '../components/ui';
import { IconExternal, IconGlobe, IconX } from '../components/Icons';

const FIELDS: [string, string, string][] = [
  ['social.x', 'X (Twitter)', 'https://x.com/yourhandle'], ['social.discord', 'Discord invite', 'https://discord.gg/xxxx'],
  ['social.telegram', 'Telegram (optional)', 'https://t.me/yourgroup'], ['social.website', 'Website (optional)', 'https://…'],
];

export default function SiteSettings(_: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => authed.get<{ settings: Record<string, string> }>('/admin/settings') });
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const v = f ?? Object.fromEntries(FIELDS.map(([k]) => [k, q.data?.settings[k] || '']));
  const bad = (x: string) => !!x.trim() && !/^https:\/\/\S+$/i.test(x.trim());
  async function save() {
    setSaving(true);
    try {
      await authed.put('/admin/settings', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null])));
      toast('The website shows the new links within 30 seconds.', 'success', { title: 'Links saved' });
      setF(null);
      q.refetch();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }
  if (!q.data) return <Skeleton h={260} r={18} />;
  return (
    <Card title="Community links" sub="Shown as icons in the website footer. Leave a field empty to hide that icon."
      right={<a className="btn btn--sm btn--outline" href={SITE_URL} target="_blank" rel="noreferrer"><IconExternal size={14} />View site</a>}
      foot={<><button className="btn" disabled={saving || Object.values(v).some(bad)} onClick={save}>{saving && <span className="spinner" />}Save links</button>{f && <button className="btn btn--ghost" onClick={() => setF(null)}>Discard changes</button>}</>}>
      <div className="form-grid">
        {FIELDS.map(([k, label, ph]) => (
          <div className="field" key={k}>
            <label htmlFor={k} className="row" style={{ gap: 6 }}>{k === 'social.x' ? <IconX size={13} /> : <IconGlobe size={14} />}{label}</label>
            <input id={k} className={`input ${bad(v[k]) ? 'input--invalid' : ''}`} placeholder={ph} value={v[k]} onChange={(e) => setF({ ...v, [k]: e.target.value })} />
            {bad(v[k]) && <span className="hint" style={{ color: 'var(--bad)' }}>Links must start with https://</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}
