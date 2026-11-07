/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project ID from https://dashboard.reown.com — enables QR codes, mobile wallets and the full wallet list. */
  readonly VITE_REOWN_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
