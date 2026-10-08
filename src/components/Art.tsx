import { useMemo, useState, type ReactNode } from 'react';
import { hashSeed, mulberry32 } from '../lib/art';
import { isLoadableMedia } from '../lib/mediaLink';

// Colours come from the theme (see --art-* in styles.css), so generated art follows light and dark.
const ACCENTS = ['var(--art-a1)', 'var(--art-a2)', 'var(--art-a3)'];

/**
 * Placeholder art for collections without images (same as the website): a symmetric lattice, a nod to the
 * QUBO matrices that QMS miners solve. Every seed gives a different lattice.
 */
export function TileArt({ seed, wide = false }: { seed: string; wide?: boolean }) {
  const s = useMemo(() => {
    const rand = mulberry32(hashSeed(seed));
    const n = 4 + Math.floor(rand() * 4);
    const accent = ACCENTS[Math.floor(rand() * ACCENTS.length)];
    const round = rand() > 0.5;
    const w: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const v = rand();
        const weight = v < 0.34 ? 0 : v < 0.62 ? 0.12 : v < 0.86 ? 0.32 : 0.78;
        w[i][j] = weight;
        w[j][i] = weight;
      }
    }
    return { n, accent, round, w };
  }, [seed]);
  const H = 100;
  const W = wide ? 300 : 100;
  const cell = H / s.n;
  const gap = cell * 0.09;
  const cols = Math.ceil(W / cell);
  const cells: ReactNode[] = [];
  for (let r = 0; r < s.n; r++) {
    for (let c = 0; c < cols; c++) {
      const j = c % s.n;
      const weight = s.w[r][j];
      const diagonal = r === j;
      if (!weight && !diagonal) continue;
      cells.push(
        <rect key={`${r}-${c}`} x={c * cell + gap} y={r * cell + gap} width={cell - gap * 2} height={cell - gap * 2}
          rx={s.round ? (cell - gap * 2) / 2 : cell * 0.14} style={{ fill: diagonal ? s.accent : 'var(--art-cell)' }} opacity={(diagonal ? 0.95 : weight) * (wide ? 0.55 : 1)} />,
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="art" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">
      <rect width={W} height={H} style={{ fill: 'var(--art-bg)' }} />
      {cells}
    </svg>
  );
}

/** Image with skeleton while loading and generated art if it fails. */
/** ipfs:// and ar:// links open through a public gateway; https links are used as they are. */
export const mediaUrl = (u: string) =>
  u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, '')}` : u.startsWith('ar://') ? `https://arweave.net/${u.slice(5)}` : u;

export function SmartImage({ src: raw, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
  // Only public hosts, embedded pictures and the panel's own files are ever loaded (see lib/mediaLink).
  const src = isLoadableMedia(raw) ? mediaUrl(raw) : '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  if (state === 'error' || !src) return <>{fallback}</>;
  return (
    <>
      {state === 'loading' && <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />}
      <img
        className="art"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
        style={state === 'loading' ? { opacity: 0 } : undefined}
      />
    </>
  );
}

type ColLike = { address: string; art_style?: 'official' | 'tile' | string | null; image_url?: string | null; banner_url?: string | null; name?: string };

export function CollectionAvatar({ collection }: { collection: ColLike }) {
  const generated = <TileArt seed={collection.address} />;
  if (collection.image_url) return <SmartImage src={collection.image_url} alt={collection.name || ''} fallback={generated} />;
  return generated;
}

/** Wallet avatar: a small symmetric lattice unique to the address. */
export function Avatar({ address, size = 32 }: { address: string; size?: number }) {
  const a = useMemo(() => {
    const rand = mulberry32(hashSeed(address.toLowerCase()));
    const color = ACCENTS[Math.floor(rand() * ACCENTS.length)];
    const on: boolean[][] = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { on[y][x] = rand() > 0.5; on[y][4 - x] = on[y][x]; }
    return { color, on };
  }, [address]);
  return (
    <span className="avatar" style={{ width: size, height: size, display: 'inline-block' }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <rect width="40" height="40" style={{ fill: 'var(--art-bg)' }} />
        {a.on.flatMap((row, y) => row.map((v, x) => (v ? <rect key={`${x}-${y}`} x={7.5 + x * 5} y={7.5 + y * 5} width="5" height="5" style={{ fill: a.color }} /> : null)))}
        <circle cx="20" cy="20" r="19.4" fill="none" style={{ stroke: 'var(--line-strong)' }} />
      </svg>
    </span>
  );
}
