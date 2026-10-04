import { createConfig, http } from 'wagmi';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import type { Chain } from 'viem';
import { activeChain } from '../config';

export function createWagmi(chain: Chain) {
  return createConfig({
    chains: [chain],
    connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: 'Quantly Admin', version: '4', preference: { options: 'eoaOnly' } })],
    // The public QMS RPC is shared and rate limited: batch reads and poll gently.
    transports: { [chain.id]: http(undefined, { batch: { wait: 20, batchSize: 50 }, retryCount: 3, retryDelay: 400 }) },
    batch: { multicall: { wait: 20 } },
    pollingInterval: 5_000,
    multiInjectedProviderDiscovery: true,
  });
}

export let wagmiConfig = createWagmi(activeChain);
export function initWagmi(chain: Chain) {
  wagmiConfig = createWagmi(chain);
}

declare module 'wagmi' {
  interface Register {
    config: ReturnType<typeof createWagmi>;
  }
}
