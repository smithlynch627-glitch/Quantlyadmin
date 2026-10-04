// Single-series column chart: thin columns (≤ 24px) with a 4px rounded top, hairline grid, 3 clean y ticks,
// a tooltip per column on hover and keyboard focus, and a data table for anyone who can't use the chart.
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Point { label: string; value: number }

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const dayLabel = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** Compact coin figures for axes and tooltips: 0.00097, 0.012, 1.25, 1,240. */
export const coinFigure = (n: number) => (n === 0 ? '0' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toLocaleString('en-US', { maximumSignificantDigits: 3 }));

export function ColumnChart({ data, format, height = 210, label, dim = false }: { data: Point[]; format: (n: number) => string; height?: number; label: string; dim?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const ticks = [0, max / 2, max];
  // Left gutter sized to the longest y label (11px tabular figures ≈ 6.6px per character).
  const pad = { l: Math.max(36, Math.ceil(Math.max(...ticks.map((t) => format(t).length)) * 6.6) + 12), r: 6, t: 12, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(24, band - 2)); // 2px surface gap between columns
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const labelIdx = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);

  const colPath = (x: number, top: number, w: number, base: number) => {
    const h = base - top;
    const r = Math.min(4, w / 2, h);
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
  };

  const h = hover !== null ? data[hover] : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div ref={box} className={`chart ${dim ? 'is-dim' : ''}`} role="group" aria-label={label}>
        <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
              <text className="axis-text" x={pad.l - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * band + (band - barW) / 2;
            const top = d.value > 0 ? Math.min(y(d.value), pad.t + plotH - 2) : pad.t + plotH;
            return (
              <g key={d.label} className={hover === i ? 'is-hover' : ''}>
                <rect className="bar-hit" x={pad.l + i * band} y={pad.t} width={band} height={plotH} tabIndex={0}
                  aria-label={`${dayLabel(d.label)}: ${format(d.value)}`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                {d.value > 0 && <path className="bar" d={colPath(x, top, barW, pad.t + plotH)} pointerEvents="none" />}
              </g>
            );
          })}
          {labelIdx.map((i) => (
            <text key={i} className="axis-text" x={pad.l + i * band + band / 2} y={height - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
              {dayLabel(data[i].label)}
            </text>
          ))}
        </svg>
        {h && hover !== null && (
          <div className="chart-tip" style={{ left: Math.min(width - 60, Math.max(60, pad.l + hover * band + band / 2)), top: h.value > 0 ? y(h.value) : pad.t + plotH }}>
            <b>{format(h.value)}</b><span>{dayLabel(h.label)}</span>
          </div>
        )}
      </div>
      <details className="tiny muted">
        <summary style={{ cursor: 'pointer', width: 'fit-content' }}>Show as table</summary>
        <div className="table-wrap" style={{ maxHeight: 220, marginTop: 8 }}>
          <table className="dtable"><thead><tr><th>Day</th><th className="right">Value</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.label}><td>{dayLabel(d.label)}</td><td className="right num">{format(d.value)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
