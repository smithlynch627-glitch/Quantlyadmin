import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { activeChain } from '../config';
import { short } from '../lib/format';
import {
  IconAlert, IconCheck, IconCheckCircle, IconClose, IconCopy, IconExternal, IconInfo, IconMore, IconVerified, IconWarning, IconXCircle,
} from './Icons';

export type Tone = 'good' | 'warning' | 'danger' | 'neutral';

// ── Modal (bottom sheet on phones) ─────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480, bare = false }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; bare?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-root" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" style={{ ['--w' as any]: `${width}px` }}>
        {!bare && (
          <div className="modal__head">
            <div className="modal__title">{title}</div>
            <button className="icon-btn icon-btn--sm icon-btn--plain" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>
          </div>
        )}
        {bare ? children : <div className="modal__body">{children}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'info' | 'warning';
type ToastOpts = { title?: string; action?: { label: string; href: string } };
type Toast = { id: number; message: string; kind: ToastKind; ms: number } & ToastOpts;
type ToastFn = (message: string, kind?: ToastKind, opts?: ToastOpts) => void;
const ToastCtx = createContext<ToastFn>(() => {});
const TOAST_TITLE: Record<ToastKind, string> = { success: 'Done', error: 'Something went wrong', info: 'Heads up', warning: 'Check this' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<ToastFn>((message, kind = 'success', opts = {}) => {
    const id = Date.now() + Math.random();
    const ms = kind === 'error' ? 9000 : kind === 'warning' ? 7000 : 4500;
    setToasts((ts) => [...ts.slice(-3), { id, message, kind, ms, ...opts }]);
    setTimeout(() => remove(id), ms);
  }, [remove]);
  const icon = (k: ToastKind) => (k === 'error' ? <IconXCircle size={17} /> : k === 'warning' ? <IconWarning size={17} /> : k === 'info' ? <IconInfo size={17} /> : <IconCheck size={17} />);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <span className="toast__icon">{icon(t.kind)}</span>
              <div className="toast__body">
                <span className="toast__title">{t.title || TOAST_TITLE[t.kind]}</span>
                <span className="toast__msg">{t.message}</span>
                {t.action && <a className="toast__action" href={t.action.href} target="_blank" rel="noreferrer">{t.action.label}<IconExternal size={13} /></a>}
              </div>
              <button className="toast__close" onClick={() => remove(t.id)} aria-label="Dismiss"><IconClose size={15} /></button>
              <span className="toast__bar" style={{ animationDuration: `${t.ms}ms` }} />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── Dialogs: confirm / typed confirm / prompt (replaces window.confirm & window.prompt) ─────────────
type DialogTone = 'default' | 'danger' | 'warning' | 'good';
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  tone?: DialogTone;
  icon?: ReactNode;
  details?: [string, ReactNode][];
  confirmLabel?: string;
  cancelLabel?: string;
  /** The user must type this exactly to enable the confirm button. */
  typeToConfirm?: string;
}
interface PromptOptions extends Omit<ConfirmOptions, 'typeToConfirm'> { label?: string; placeholder?: string; initial?: string; validate?: (v: string) => string | null }
type Pending = { kind: 'confirm'; o: ConfirmOptions; resolve: (v: boolean) => void } | { kind: 'prompt'; o: PromptOptions; resolve: (v: string | null) => void };
const DialogCtx = createContext<{ confirm: (o: ConfirmOptions) => Promise<boolean>; prompt: (o: PromptOptions) => Promise<string | null> }>({
  confirm: async () => false, prompt: async () => null,
});

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', o, resolve })), []);
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((resolve) => setPending({ kind: 'prompt', o, resolve })), []);
  const close = (v: boolean | string | null) => {
    if (!pending) return;
    (pending.resolve as (x: any) => void)(v);
    setPending(null);
  };
  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      {pending && <DialogView p={pending} onDone={close} />}
    </DialogCtx.Provider>
  );
}
export const useDialog = () => useContext(DialogCtx);

function DialogView({ p, onDone }: { p: Pending; onDone: (v: any) => void }) {
  const o = p.o;
  const tone = o.tone || 'default';
  const [text, setText] = useState(p.kind === 'prompt' ? p.o.initial || '' : '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const typed = p.kind === 'confirm' ? p.o.typeToConfirm : undefined;
  const error = p.kind === 'prompt' && p.o.validate ? p.o.validate(text) : null;
  const canConfirm = p.kind === 'confirm' ? !typed || text.trim() === typed : !error && text.trim() !== '';
  const cancel = () => onDone(p.kind === 'confirm' ? false : null);
  const ok = () => canConfirm && onDone(p.kind === 'confirm' ? true : text.trim());
  const icon = o.icon ?? (tone === 'danger' ? <IconAlert size={22} /> : tone === 'warning' ? <IconWarning size={22} /> : tone === 'good' ? <IconCheckCircle size={22} /> : <IconInfo size={22} />);
  return (
    <Modal open onClose={cancel} width={460} bare>
      <form className={`dialog dialog--${tone}`} onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span className="dialog__icon">{icon}</span>
          <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" onClick={cancel} aria-label="Close"><IconClose size={16} /></button>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="dialog__title">{o.title}</div>
          {o.message && <div className="dialog__msg">{o.message}</div>}
        </div>
        {o.details && o.details.length > 0 && (
          <div className="dialog__details"><dl className="kv">{o.details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
        )}
        {(typed || p.kind === 'prompt') && (
          <div className="field">
            <label htmlFor="dlg-input">{typed ? <>Type <span className="mono strong">{typed}</span> to confirm</> : (p.o as PromptOptions).label || 'Value'}</label>
            <input id="dlg-input" ref={input} className={`input ${error && text ? 'input--invalid' : ''}`} value={text} autoComplete="off" spellCheck={false}
              placeholder={p.kind === 'prompt' ? p.o.placeholder : typed} onChange={(e) => setText(e.target.value)} />
            {error && text && <span className="hint" style={{ color: 'var(--bad)' }}>{error}</span>}
          </div>
        )}
        <div className="dialog__foot">
          <button type="button" className="btn btn--outline" onClick={cancel}>{o.cancelLabel || 'Cancel'}</button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn--danger' : ''}`} disabled={!canConfirm}>{o.confirmLabel || 'Confirm'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Inline alert ───────────────────────────────────────────────────────────────────────────────────
export function Alert({ tone = 'neutral', title, children, action, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  const ic = icon ?? (tone === 'good' ? <IconCheckCircle size={19} /> : tone === 'warning' ? <IconWarning size={19} /> : tone === 'danger' ? <IconAlert size={19} /> : <IconInfo size={19} />);
  return (
    <div className={`alert ${tone !== 'neutral' ? `alert--${tone}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      {ic}
      <div className="alert__body">{title && <div className="alert__title">{title}</div>}{children && <div>{children}</div>}</div>
      {action && <div className="alert__action">{action}</div>}
    </div>
  );
}

/** Explains why a panel section could not load (instead of guessing), with a retry button. */
export function explainError(error: unknown): string {
  const e = error as { status?: number; message?: string };
  if (e?.status === 404) return 'The API on Railway does not have this part of the admin panel yet. Push the updated backend and wait until Railway shows the new deployment as active.';
  return e?.message || 'Unknown error';
}
export function LoadError({ error, what, retry }: { error: unknown; what: string; retry?: () => void }) {
  return (
    <Alert tone="danger" title={`Could not load ${what}`} action={retry && <button className="btn btn--sm btn--outline" onClick={retry}>Retry</button>}>
      {explainError(error)}
    </Alert>
  );
}

// ── Status pill (icon + label, never colour alone) ─────────────────────────────────────────────────
export function Status({ tone = 'neutral', children, icon }: { tone?: Tone | 'solid'; children: ReactNode; icon?: ReactNode }) {
  const ic = icon ?? (tone === 'good' ? <IconCheckCircle size={14} /> : tone === 'warning' ? <IconWarning size={14} /> : tone === 'danger' ? <IconXCircle size={14} /> : null);
  return <span className={`status ${tone !== 'neutral' ? `status--${tone}` : ''}`}>{ic}{children}</span>;
}

// ── Cards and stats ────────────────────────────────────────────────────────────────────────────────
export function Card({ title, sub, right, children, foot, className = '', flush = false, id }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; foot?: ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || right) && (
        <div className="card__head">
          <div style={{ minWidth: 0 }}>{title && <h3 className="card__title">{title}</h3>}{sub && <div className="card__sub">{sub}</div>}</div>
          {right && <div className="row-wrap">{right}</div>}
        </div>
      )}
      {children !== undefined && <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>}
      {foot && <div className="card__foot">{foot}</div>}
    </section>
  );
}

export function Stat({ label, value, unit, sub, icon }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__label">{icon && <span className="stat__icon">{icon}</span>}{label}</span>
      <span className="stat__value">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export const Skeleton = ({ h = 16, r, w }: { h?: number; r?: number; w?: number | string }) => <div className="skeleton" style={{ height: h, borderRadius: r, width: w }} />;

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <span className="empty__icon">{icon}</span>}
      <div className="empty__title">{title}</div>
      {body && <div className="empty__body">{body}</div>}
      {action}
    </div>
  );
}

export function Badge({ official, verified, size = 16 }: { official?: boolean; verified?: boolean; size?: number }) {
  if (!official && !verified) return null;
  return <span title={official ? 'Official' : 'Verified'} style={{ display: 'inline-flex' }}><IconVerified size={size} official={official} /></span>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, ReactNode][]; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

// ── Addresses and copy ─────────────────────────────────────────────────────────────────────────────
export const explorer = (kind: 'address' | 'tx' | 'token', v: string) => `${activeChain.blockExplorers?.default.url?.replace(/\/$/, '')}/${kind}/${v}`;

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="addr__btn" aria-label={label} title={label} onClick={(e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => toast('Copy failed', 'error'));
    }}>{done ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>
  );
}

export function Address({ value, label, kind = 'address', full = false, link = true, copy = true }: { value?: string | null; label?: string | null; kind?: 'address' | 'tx'; full?: boolean; link?: boolean; copy?: boolean }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span className="addr" title={value}>
      <span className="addr__text">{full ? value : short(value)}</span>
      {label && <span className="addr__label">{label}</span>}
      {copy && <CopyButton value={value} />}
      {link && <a className="addr__btn" href={explorer(kind, value)} target="_blank" rel="noreferrer" aria-label="Open in explorer" title="Open in explorer" onClick={(e) => e.stopPropagation()}><IconExternal size={13} /></a>}
    </span>
  );
}

// ── Floating menu (portal, flips and clamps to the screen) ─────────────────────────────────────────
export function FloatingMenu({ anchor, open, onClose, align = 'right', minWidth = 210, children }: { anchor: RefObject<HTMLElement>; open: boolean; onClose: () => void; align?: 'left' | 'right'; minWidth?: number; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const m = 10;
      const width = Math.min(Math.max(minWidth, menu.current?.offsetWidth ?? minWidth), window.innerWidth - m * 2);
      const height = menu.current?.scrollHeight ?? 0;
      const below = window.innerHeight - a.bottom - m - 6;
      const above = a.top - m - 6;
      const up = height > below && above > below;
      const maxHeight = Math.max(140, up ? above : below);
      const left = Math.max(m, Math.min(align === 'right' ? a.right - width : a.left, window.innerWidth - m - width));
      setPos({ top: up ? Math.max(m, a.top - 6 - Math.min(height, maxHeight)) : a.bottom + 6, left, maxHeight });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, align, minWidth]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { const t = e.target as Node; if (!menu.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside); document.removeEventListener('keydown', esc); };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={menu} className="float-menu" role="menu" onClick={onClose}
      style={pos ? { top: pos.top, left: pos.left, minWidth: Math.min(minWidth, window.innerWidth - 20), maxHeight: pos.maxHeight } : { top: -9999, left: -9999, minWidth, visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

/** A "…" button with a menu of actions. */
export function RowMenu({ children, label = 'More actions' }: { children: ReactNode; label?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={btn} type="button" className="icon-btn icon-btn--sm" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <IconMore size={17} />
      </button>
      <FloatingMenu anchor={btn} open={open} onClose={close}>{children}</FloatingMenu>
    </>
  );
}
