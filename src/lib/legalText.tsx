// Same parser as the website (frontend/src/lib/legalText.tsx), used for the live preview. Keep them in sync.
// Renders the Terms / Privacy text written in the admin panel. A small, safe Markdown subset — never HTML:
//   intro paragraphs, then "## Heading" sections, blank line between paragraphs, "- " for bullet points,
//   **bold**, [link text](https://…) and bare https:// links.
import { Fragment, type ReactNode } from 'react';

export type Block = { t: 'p'; text: string } | { t: 'ul'; items: string[] };
export type LegalSection = { h: string; blocks: Block[] };
export type LegalDoc = { intro: Block[]; sections: LegalSection[] };

export function parseLegal(src: string): LegalDoc {
  const out: LegalDoc = { intro: [], sections: [] };
  let blocks = out.intro;
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    if (list?.length) blocks.push({ t: 'ul', items: list });
    para = [];
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const head = line.match(/^#{1,3}\s+(.+)$/);
    const item = line.match(/^[-*•]\s+(.+)$/);
    if (head) {
      flush();
      const s: LegalSection = { h: head[1].trim().slice(0, 200), blocks: [] };
      out.sections.push(s);
      blocks = s.blocks;
    } else if (!line) {
      flush();
    } else if (item) {
      if (para.length) { blocks.push({ t: 'p', text: para.join(' ') }); para = []; }
      (list ??= []).push(item[1]);
    } else {
      if (list?.length) { blocks.push({ t: 'ul', items: list }); list = null; }
      para.push(line);
    }
  }
  flush();
  return out;
}

const SAFE_URL = /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/i;

/** **bold**, [text](url) and bare https links, as React elements (text is never parsed as HTML). */
export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]{1,200})\]\(([^)\s]{1,500})\)|(https:\/\/[^\s<>"')]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2]) {
      const url = m[3];
      parts.push(SAFE_URL.test(url) ? <a key={k++} className="link" href={url} target="_blank" rel="noreferrer noopener">{m[2]}</a> : m[0]);
    } else if (m[4]) {
      const url = m[4].replace(/[.,;:!?]+$/, '');
      parts.push(<a key={k++} className="link" href={url} target="_blank" rel="noreferrer noopener">{url}</a>);
      if (url.length < m[4].length) parts.push(m[4].slice(url.length));
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export function Blocks({ blocks, className = 'soft' }: { blocks: Block[]; className?: string }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.t === 'p'
          ? <p key={i} className={className}><Inline text={b.text} /></p>
          : <ul key={i} className={`legal__list ${className}`}>{b.items.map((x, j) => <li key={j}><Inline text={x} /></li>)}</ul>,
      )}
    </>
  );
}
