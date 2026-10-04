export type Address = `0x${string}`;
export interface Attribute { trait_type: string; value: string; count?: number }
export interface AppConfig {
  ready: boolean;
  network?: { key: string; name: string; isTestnet: boolean };
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  market: string | null;
  factory: string | null;
  feeVault: string | null;
  wrapped: string;
}
export interface Collection {
  address: string; slug: string; name: string; description: string | null; image_url: string | null; banner_url: string | null;
  art_style: 'official' | 'tile'; creator: string | null; verified: boolean; is_official: boolean; is_external?: boolean; featured?: boolean;
  hidden?: boolean; tradable?: boolean; twitter: string | null; website: string | null; discord?: string | null; drop_hidden?: boolean;
}
