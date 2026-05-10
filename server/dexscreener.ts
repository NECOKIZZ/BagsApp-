/**
 * DexScreener API client — free, no API key required.
 * Used to enrich tokens with volume, mcap, socials, price change, and age.
 *
 * Endpoint: GET https://api.dexscreener.com/latest/dex/tokens/{mint}
 * Rate limit: ~300 req/min (generous for our use case).
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex/tokens";
const TIMEOUT_MS = 8000;

export type DexScreenerEnrichment = {
  priceUsd: number | null;
  mcap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
  txns24h: number | null;
  pairCreatedAt: number | null; // epoch ms
  hasSocials: boolean;
  socialLinks: { twitter?: string; telegram?: string; website?: string };
};

const EMPTY: DexScreenerEnrichment = {
  priceUsd: null,
  mcap: null,
  volume24h: null,
  liquidity: null,
  priceChange24h: null,
  txns24h: null,
  pairCreatedAt: null,
  hasSocials: false,
  socialLinks: {},
};

/**
 * Fetch enrichment data for a single Solana token mint from DexScreener.
 * Returns the pair with the highest liquidity (tokens can have multiple pools).
 */
export async function fetchDexScreenerData(mint: string): Promise<DexScreenerEnrichment> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${DEXSCREENER_BASE}/${mint}`, {
      method: "GET",
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      console.warn(`[dexscreener] ${mint} → HTTP ${res.status}`);
      return EMPTY;
    }

    const data = (await res.json()) as { pairs?: unknown[] };
    if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
      return EMPTY;
    }

    // Pick the pair with the highest USD liquidity (most reliable data).
    const pairs = data.pairs as Record<string, unknown>[];
    const best = pairs.reduce((a, b) => {
      const aLiq = Number((a.liquidity as Record<string, unknown>)?.usd ?? 0);
      const bLiq = Number((b.liquidity as Record<string, unknown>)?.usd ?? 0);
      return bLiq > aLiq ? b : a;
    });

    const priceUsd = toNum(best.priceUsd);
    const mcap = toNum(best.fdv) ?? toNum(best.marketCap);
    const volume24h = toNum((best.volume as Record<string, unknown>)?.h24);
    const liquidity = toNum((best.liquidity as Record<string, unknown>)?.usd);
    const priceChange24h = toNum((best.priceChange as Record<string, unknown>)?.h24);

    const txns = best.txns as Record<string, unknown> | undefined;
    const h24 = txns?.h24 as Record<string, unknown> | undefined;
    const txns24h = h24
      ? (toNum(h24.buys) ?? 0) + (toNum(h24.sells) ?? 0)
      : null;

    const pairCreatedAt = toNum(best.pairCreatedAt);

    // Socials: DexScreener puts them in `info.socials` and `info.websites`
    const info = best.info as Record<string, unknown> | undefined;
    const socials = Array.isArray(info?.socials) ? (info.socials as Record<string, unknown>[]) : [];
    const websites = Array.isArray(info?.websites) ? (info.websites as Record<string, unknown>[]) : [];

    const socialLinks: DexScreenerEnrichment["socialLinks"] = {};
    for (const s of socials) {
      const url = String(s.url ?? "").trim();
      const type = String(s.type ?? "").toLowerCase();
      if (type === "twitter" && url) socialLinks.twitter = url;
      if (type === "telegram" && url) socialLinks.telegram = url;
    }
    for (const w of websites) {
      const url = String(w.url ?? w ?? "").trim();
      if (url && url.startsWith("http")) socialLinks.website = url;
    }

    const hasSocials = Boolean(socialLinks.twitter || socialLinks.telegram || socialLinks.website);

    return {
      priceUsd,
      mcap,
      volume24h,
      liquidity,
      priceChange24h,
      txns24h,
      pairCreatedAt,
      hasSocials,
      socialLinks,
    };
  } catch (e) {
    console.warn(`[dexscreener] ${mint} failed:`, e instanceof Error ? e.message : e);
    return EMPTY;
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
