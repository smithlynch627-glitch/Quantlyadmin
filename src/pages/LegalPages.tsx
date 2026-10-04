import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageProps } from '../AdminApp';
import { SITE_URL } from '../config';
import { LEGAL_DEFAULTS } from '../content/legalDefaults';
import { Blocks, parseLegal } from '../lib/legalText';
import { useAuthedApi } from '../lib/tx';
import { Card, LoadError, Segmented, Skeleton, Status, useDialog, useToast } from '../components/ui';
import { IconExternal, IconRefresh } from '../components/Icons';

type Kind = 'terms' | 'privacy';
type Lang = 'en';
type Doc = { text: string; updated: string | null } | null;
type SiteContent = { legal: Record<Kind, Record<Lang, Doc>>; limits: { legal: number } };

const TITLES: Record<Kind, Record<Lang, string>> = { terms: { en: 'Terms of Use' }, privacy: { en: 'Privacy Policy' } };
const PATH: Record<Kind, string> = { terms: '/terms', privacy: '/privacy' };

export default function LegalPages(_: PageProps) {
  const authed = useAuthedApi();
  const toast = useToast();
  const dialog = useDialog();
  const q = useQuery({ queryKey: ['admin-site'], queryFn: () => authed.get<SiteContent>('/admin/site') });
  const [kind, setKind] = useState<Kind>('terms');
  const lang: Lang = 'en';
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = `${kind}.${lang}`;
  const saved = q.data?.legal[kind][lang] ?? null;
  const base = saved?.text ?? LEGAL_DEFAULTS[kind][lang];
  const text = drafts[key] ?? base;
  const dirty = key in drafts && drafts[key] !== base;
  const max = q.data?.limits?.legal ?? 60000;
  const preview = useMemo(() => parseLegal(text), [text]);

  if (q.isError) return <LoadError error={q.error} what="the legal pages" retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton h={520} r={18} />;
  const unsaved = (k: Kind, l: Lang) => `${k}.${l}` in drafts && drafts[`${k}.${l}`] !== (q.data!.legal[k][l]?.text ?? LEGAL_DEFAULTS[k][l]);

  async function publish(value: string) {
    setBusy(true);
    try {
      await authed.put(`/admin/site/legal/${kind}/${lang}`, { text: value });
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      await q.refetch();
      toast(value ? `${TITLES[kind][lang]} is live on the website. The "last updated" date is today.` : `${TITLES[kind][lang]} is back to the built-in text.`, 'success', { title: value ? 'Published' : 'Reset' });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const ok = await dialog.confirm({
      title: `Publish the ${TITLES[kind][lang]}?`,
      message: 'Everyone visiting the page sees this text right away, with today as the "last updated" date.',
      details: [['Page', TITLES[kind][lang]], ['Length', `${text.trim().length.toLocaleString()} characters`], ['Sections', String(preview.sections.length)]],
      confirmLabel: 'Publish',
    });
    if (ok) await publish(text);
  }
  async function reset() {
    const ok = await dialog.confirm({ title: 'Go back to the built-in text?', tone: 'danger', message: 'Your custom text is removed and the website shows the text that ships with the site again.', confirmLabel: 'Reset' });
    if (ok) await publish('');
  }

  return (
    <div className="stack-lg">
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row-wrap">
          <Segmented label="Page" value={kind} onChange={setKind} options={[['terms', <>Terms of Use{unsaved('terms', 'en') && <span className="dot-unsaved" />}</>], ['privacy', <>Privacy Policy{unsaved('privacy', 'en') && <span className="dot-unsaved" />}</>]]} />
        </div>
        <div className="row-wrap">
          {saved ? <Status tone="good">Custom text · updated {saved.updated}</Status> : <Status>Built-in text</Status>}
          <a className="btn btn--sm btn--outline" href={`${SITE_URL}${PATH[kind]}`} target="_blank" rel="noreferrer"><IconExternal size={14} />Open page</a>
        </div>
      </div>

      <div className="legal-editor">
        <Card title="Edit" sub={<>Blank line = new paragraph · <code>## Heading</code> = new section · <code>- </code> bullet · <code>**bold**</code> · <code>[text](https://link)</code></>}
          foot={<>
            <button className="btn" disabled={busy || !text.trim() || text.length > max || (!dirty && !!saved)} onClick={save}>{busy && <span className="spinner" />}{saved || dirty ? 'Publish' : 'Publish as custom text'}</button>
            {dirty && <button className="btn btn--ghost" disabled={busy} onClick={() => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; })}>Discard changes</button>}
            {saved && <button className="btn btn--ghost" disabled={busy} onClick={reset}><IconRefresh size={14} />Reset to built-in</button>}
            <span className={`hint mono ${text.length > max ? 'hint--bad' : ''}`} style={{ marginLeft: 'auto' }}>{text.length.toLocaleString()} / {max.toLocaleString()}</span>
          </>}>
          <textarea className="textarea legal-editor__text" value={text} spellCheck lang={lang} aria-label={`${TITLES[kind][lang]} text`}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
          {!saved && !dirty && <span className="hint">This is the built-in text the website shows now. Edit it and publish to replace it.</span>}
        </Card>

        <Card title="Preview" sub={`How ${TITLES[kind][lang]} looks on the website`} className="legal-preview">
          <div className="legal-preview__body" lang={lang}>
            <h2 className="legal-preview__title">{TITLES[kind][lang]}</h2>
            <Blocks blocks={preview.intro} className="legal-preview__lead" />
            {preview.sections.map((s, i) => (
              <section key={i}>
                <h3>{s.h}</h3>
                <Blocks blocks={s.blocks} />
              </section>
            ))}
            {preview.sections.length === 0 && <p className="hint">Add sections with a line that starts with <code>## </code>.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
