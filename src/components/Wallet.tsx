import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccount, useAccountEffect, useConfig, useConnect, useSwitchChain } from 'wagmi';
import { reconnect, watchConnectors } from 'wagmi/actions';
import { activeChain } from '../config';
import { errorMessage } from '../lib/tx';
import { IconWallet } from './Icons';
import { Modal, useToast } from './ui';

const LAST = 'quantly.admin.admin.wallet';
interface WalletUI { openConnect: () => void; ensureReady: () => Promise<boolean>; forget: () => void }
const Ctx = createContext<WalletUI>({ openConnect: () => {}, ensureReady: async () => false, forget: () => {} });
export const useWalletUI = () => useContext(Ctx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const tried = useRef(false);

  // Only reconnect the wallet this admin explicitly connected before.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LAST); } catch {}
    if (!saved) return;
    const attempt = () => {
      const c = config.connectors.find((x) => x.id === saved);
      if (!c || tried.current) return;
      tried.current = true;
      reconnect(config, { connectors: [c] }).catch(() => undefined);
    };
    attempt();
    const unwatch = watchConnectors(config, { onChange: attempt });
    return () => unwatch();
  }, [config]);
  useAccountEffect({ onConnect: ({ connector }) => { try { localStorage.setItem(LAST, connector.id); } catch {} } });

  const ensureReady = useCallback(async () => {
    if (!isConnected) { setOpen(true); return false; }
    if (chainId !== activeChain.id) {
      try { await switchChainAsync({ chainId: activeChain.id }); return true; } catch (e) { toast(errorMessage(e), 'error'); return false; }
    }
    return true;
  }, [isConnected, chainId, switchChainAsync, toast]);
  const forget = useCallback(() => { try { localStorage.removeItem(LAST); } catch {} }, []);
  const value = useMemo(() => ({ openConnect: () => setOpen(true), ensureReady, forget }), [ensureReady, forget]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { connectors, connectAsync } = useConnect();
  const [pending, setPending] = useState<string | null>(null);
  const list = useMemo(() => {
    const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected');
    const legacy = connectors.find((c) => c.id === 'injected');
    const cb = connectors.find((c) => c.id === 'coinbaseWalletSDK');
    const out = [...discovered];
    if (!discovered.length && legacy && (window as any).ethereum) out.push(legacy);
    if (cb && !discovered.some((c) => c.id === 'com.coinbase.wallet')) out.push(cb);
    return out;
  }, [connectors]);
  async function connect(c: (typeof connectors)[number]) {
    setPending(c.uid);
    try { await connectAsync({ connector: c, chainId: activeChain.id }); onClose(); } catch (e) { toast(errorMessage(e), 'error'); } finally { setPending(null); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Connect admin wallet" width={420}>
      <div className="wallet-list">
        {list.map((c) => (
          <button key={c.uid} className="wallet-option" onClick={() => connect(c)} disabled={!!pending}>
            {c.icon ? <img src={c.icon} alt="" width={36} height={36} /> : <span className="wallet-option__icon"><IconWallet /></span>}
            <span className="wallet-option__name">{c.id === 'coinbaseWalletSDK' ? 'Base (Coinbase Wallet)' : c.id === 'injected' ? 'Browser wallet' : c.name}</span>
            {pending === c.uid && <span className="spinner" />}
          </button>
        ))}
        {!list.length && <p className="notice">No browser wallet found. Use a hardware-backed wallet for admin work.</p>}
      </div>
    </Modal>
  );
}
