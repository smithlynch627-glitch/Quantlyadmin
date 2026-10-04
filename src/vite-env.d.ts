/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_MARKET_ADDRESS?: string;
  readonly VITE_FACTORY_ADDRESSES?: string;
  readonly VITE_FEE_VAULT_ADDRESS?: string;
  readonly VITE_SAFE_ADDRESS?: string;
  readonly VITE_WRAPPED_ADDRESS?: string;
  readonly VITE_NATIVE_SYMBOL?: string;
  readonly VITE_WRAPPED_SYMBOL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
