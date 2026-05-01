/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_SOLANA_RPC?: string;
  readonly VITE_JUPITER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
