import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { API_URL, makeChain, setActiveChain, setAppConfig } from './config';
import { initWagmi, wagmiConfig } from './lib/wagmi';
import type { AppConfig } from './lib/types';
import { DialogProvider, ToastProvider } from './components/ui';
import { WalletProvider } from './components/Wallet';
import AdminApp from './AdminApp';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } } });

async function boot() {
  let cfg: AppConfig | null = null;
  try {
    cfg = (await (await fetch(`${API_URL}/api/config`, { signal: AbortSignal.timeout(8000) })).json()) as AppConfig;
    const chain = makeChain({ chainId: cfg.chainId, name: cfg.network?.name || 'QMS Testnet', rpcUrl: cfg.rpcUrl, explorerUrl: cfg.explorerUrl, isTestnet: cfg.network?.isTestnet ?? true });
    setActiveChain(chain);
    setAppConfig(cfg);
    initWagmi(chain);
  } catch {}
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <DialogProvider>
              <WalletProvider>
                <AdminApp apiReachable={!!cfg} />
              </WalletProvider>
            </DialogProvider>
          </ToastProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  );
}
boot();
