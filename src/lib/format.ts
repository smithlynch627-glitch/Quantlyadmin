import { formatUnits, parseUnits } from 'viem';
type Lang = 'en';

export function fromWei(wei: string | bigint | null | undefined, digits = 4): string {
  if (wei === null || wei === undefined || wei === '') return '—';
  const n = Number(formatUnits(BigInt(wei), 18));
  if (n === 0) return '0';
  if (n < 0.000001) return '<0.000001';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  // small prices keep `digits` significant figures: 0.00015, 0.0009625
  return Number(n.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}

export const toWei = (v: string) => {
  try {
    return parseUnits((v || '0').trim(), 18);
  } catch {
    return null;
  }
};

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

export const num = (n: number | null | undefined, lang: Lang = 'en') =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-US');

export function timeAgo(date: string | number | Date, lang: Lang): string {
  const diff = (new Date(date).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / (86400 * 30)), 'month');
}

/** Compact countdown like "2d 4h" / "3h 12m" / "45s". */
export function countdown(ms: number, lang: Lang): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const u = { d: 'd', h: 'h', m: 'm', s: 's' };
  if (d > 0) return `${d}${u.d} ${h}${u.h}`;
  if (h > 0) return `${h}${u.h} ${m}${u.m}`;
  if (m > 0) return `${m}${u.m} ${sec}${u.s}`;
  return `${sec}${u.s}`;
}

export const dateTime = (d: string | Date, lang: Lang) =>
  new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const pct = (part: number, total: number) => (total > 0 ? Math.max(0.1, Math.round((part / total) * 1000) / 10) : 0);

export const bpsFee = (wei: bigint, bps: number) => (wei * BigInt(bps)) / 10000n;
