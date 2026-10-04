import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A production build of the admin site must pin the chain, RPC and contracts it works with, so a tampered API
 * can never point admin transactions or Safe signatures somewhere else. VITE_SAFE_ADDRESS is also needed for
 * signing in the Multisig and Treasury pages (without it those pages stay read-only).
 */
function requirePins(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (env.ALLOW_UNPINNED === '1') return;
  const addr = /^0x[0-9a-fA-F]{40}$/;
  const problems: string[] = [];
  if (!/^https:\/\//.test(String(env.VITE_API_URL || ''))) problems.push('VITE_API_URL (your Railway API, https)');
  if (!addr.test(String(env.VITE_MARKET_ADDRESS || '').trim())) problems.push('VITE_MARKET_ADDRESS (the marketplace contract)');
  const facs = String(env.VITE_FACTORY_ADDRESSES || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!facs.length || !facs.every((f) => addr.test(f))) problems.push('VITE_FACTORY_ADDRESSES (launchpad factories, comma separated)');
  if (!addr.test(String(env.VITE_FEE_VAULT_ADDRESS || '').trim())) problems.push('VITE_FEE_VAULT_ADDRESS (the FeeVault contract)');
  if (!/^\d+$/.test(String(env.VITE_CHAIN_ID || ''))) problems.push('VITE_CHAIN_ID (19480 for QMS Testnet)');
  if (!/^https:\/\//.test(String(env.VITE_RPC_URL || ''))) problems.push('VITE_RPC_URL (https RPC, e.g. https://rpc.testnet.qms.finance)');
  if (problems.length) {
    throw new Error(`\n\nSecurity settings missing for this production build. Add these in Netlify → Site configuration → Environment variables:\n  - ${problems.join('\n  - ')}\n`);
  }
  if (!addr.test(String(env.VITE_SAFE_ADDRESS || '').trim())) {
    console.warn('\n[admin] VITE_SAFE_ADDRESS is not set: Multisig signing and executing will be disabled on this build.\n');
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') requirePins(mode);
  return {
    plugins: [react()],
    server: { port: 5174 },
    preview: { port: 5174 },
    build: { chunkSizeWarningLimit: 1500, sourcemap: false },
  };
});
