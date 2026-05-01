export const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_TOKEN_LIST = "https://tokens.jup.ag/tokens?tags=verified";

export interface TokenMeta {
  address: string;
  name: string;
  symbol: string;
  logoURI?: string;
  decimals: number;
}

const SOL_FALLBACK: TokenMeta = {
  address: SOL_MINT,
  name: "Wrapped SOL",
  symbol: "SOL",
  logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  decimals: 9,
};

let tokenCache: Map<string, TokenMeta> | null = null;
const CACHE_KEY = "jupiter_token_map_v1";
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchJupiterTokenMap(): Promise<Map<string, TokenMeta>> {
  if (tokenCache) return tokenCache;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; items: TokenMeta[] };
        if (Date.now() - parsed.ts < CACHE_TTL_MS && Array.isArray(parsed.items)) {
          const cached = new Map<string, TokenMeta>();
          for (const t of parsed.items) {
            if (t?.address) cached.set(t.address, t);
          }
          cached.set(SOL_MINT, cached.get(SOL_MINT) ?? SOL_FALLBACK);
          tokenCache = cached;
          return tokenCache;
        }
      }
    } catch {
      // no-op
    }
  }

  const map = new Map<string, TokenMeta>();
  map.set(SOL_MINT, SOL_FALLBACK);
  try {
    const r = await fetch(JUPITER_TOKEN_LIST);
    if (r.ok) {
      const list = (await r.json()) as TokenMeta[];
      for (const t of list) {
        if (t?.address) map.set(t.address, t);
      }
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: [...map.values()] }));
        } catch {
          // no-op
        }
      }
    }
  } catch {
    // Keep fallback-only map.
  }
  tokenCache = map;
  return map;
}

export async function getTokenMetaByMint(mint: string): Promise<TokenMeta | null> {
  const map = await fetchJupiterTokenMap();
  return map.get(mint) ?? null;
}

export function getTokenMetaSync(mint: string, map: Map<string, TokenMeta>): TokenMeta | null {
  return map.get(mint) ?? (mint === SOL_MINT ? SOL_FALLBACK : null);
}

export function shortMint(mint: string): string {
  if (!mint) return "";
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}
