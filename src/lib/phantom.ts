import type { VersionedTransaction } from "@solana/web3.js";

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  disconnect: () => Promise<void>;
};

type WindowWithPhantom = Window & {
  solana?: PhantomProvider;
  phantom?: { solana?: PhantomProvider };
};

/**
 * Detects Phantom across both legacy (`window.solana`) and current
 * (`window.phantom.solana`) injection points. Returns the first that looks like Phantom.
 */
export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithPhantom;
  const a = w.phantom?.solana;
  if (a?.isPhantom) return a;
  const b = w.solana;
  if (b?.isPhantom) return b;
  // Fall back: any provider exposing connect/signTransaction (Solflare/Backpack via window.solana)
  if (b && typeof b.connect === "function" && typeof b.signTransaction === "function") return b;
  return null;
}

export function hasAnySolanaWallet(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as WindowWithPhantom;
  return Boolean(w.phantom?.solana || w.solana);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
