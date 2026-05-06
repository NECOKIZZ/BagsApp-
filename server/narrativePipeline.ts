
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
import { bagsListAllPools, bagsFetchFeed, type BagsFeedToken } from "./bagsClient";
import { calculateScratchScore } from "./scoring";

// How many of the AI's candidate token terms we actually search.
const MAX_CANDIDATES_TO_SEARCH = 4;
// How many Jupiter results we scan per term before filtering against the Bags
// catalog. Most won't be on Bags, so we take a wide net here. Jupiter caps at
// 100 by default; 50 keeps response sizes reasonable.
const MAX_RESULTS_PER_TERM = 50;
const MAX_TOKENS_TO_STORE = 10;
// Delay between search calls (be a polite client).
const SEARCH_DELAY_MS = 250;
// How long to trust the cached Bags pool list before refetching.
const BAGS_POOLS_CACHE_TTL_MS = 5 * 60 * 1000;
// Feed cache refresh interval (default 10 minutes).
const FEED_CACHE_INTERVAL_MS = Number(process.env.FEED_CACHE_INTERVAL_MS ?? 10 * 60 * 1000);
// Minimum feed cache hits before we bother with Jupiter fallback.
const FEED_CACHE_MIN_HITS = 3;

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

// ── Source 1: Bags Feed Cache (fresh tokens) ─────────────────
// In-memory cache of all tokens from the Bags feed endpoint.
// Keyed by tokenMint for deduplication; searched by name + symbol.
let feedCache: Map<string, BagsFeedToken> = new Map();
let feedCacheRefreshedAt = 0;

/**
 * Fetches the Bags feed and replaces the in-memory cache.
 * Exported so index.ts can call it on startup.
 */
export async function refreshFeedCache(): Promise<void> {
  const tokens = await bagsFetchFeed();
  if (tokens.length === 0 && feedCache.size > 0) {
    console.warn("[NarrativePipeline] feed refresh returned 0 tokens; keeping stale cache.");
    return;
  }
  feedCache = new Map(tokens.map((t) => [t.tokenMint, t]));
  feedCacheRefreshedAt = Date.now();
  console.log(`[NarrativePipeline] feed cache refreshed: ${feedCache.size} tokens`);
}

/**
 * Starts the periodic feed cache refresher.
 * Called once from index.ts on server boot.
 */
export function startFeedCacheRefresher(): void {
  console.log(`[feed-cache] enabled, interval=${Math.round(FEED_CACHE_INTERVAL_MS / 1000)}s`);
  // First refresh after a short delay so startup logs finish.
  setTimeout(() => {
    void refreshFeedCache();
    setInterval(() => void refreshFeedCache(), FEED_CACHE_INTERVAL_MS);
  }, 5_000);
}

/**
 * Search the feed cache by matching a query against name and symbol ONLY.
 * No description matching — too loose and produces false positives with common words.
 * Case-insensitive substring match.
 */
function searchFeedCache(query: string): SearchHit[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: SearchHit[] = [];
  for (const token of feedCache.values()) {
    const nameLower = (token.name || "").toLowerCase();
    const symbolLower = (token.symbol || "").toLowerCase();

    // Exact symbol match gets highest priority
    const exactSymbol = symbolLower === q;
    // Substring match on name or symbol
    const nameMatch = nameLower.includes(q);
    const symbolMatch = symbolLower.includes(q);

    if (exactSymbol || nameMatch || symbolMatch) {
      // Quality boost: exact symbol match = 80, name match = 60, partial symbol = 50
      const quality = exactSymbol ? 80 : nameMatch ? 60 : 50;
      results.push({
        mint: token.tokenMint,
        name: token.name,
        symbol: token.symbol,
        quality,
      });
    }
  }

  // Sort: exact symbol matches first, then by quality
  return results.sort((a, b) => b.quality - a.quality);
}

// ── Source 2: Bags Mint Set Cache (for Jupiter filtering) ────
// Module-level cache of Bags-launched mints. Bags' catalog grows slowly so a
// 5-minute cache massively reduces calls when many tweets process in a row.
let bagsMintCache: { set: Set<string>; fetchedAt: number } | null = null;

async function getBagsMintSet(): Promise<Set<string>> {
  const now = Date.now();
  if (bagsMintCache && now - bagsMintCache.fetchedAt < BAGS_POOLS_CACHE_TTL_MS) {
    return bagsMintCache.set;
  }
  const pools = await bagsListAllPools();
  if (pools.length === 0 && bagsMintCache) {
    // Fetch failed — keep the stale cache rather than wiping all matches.
    console.warn("[NarrativePipeline] bagsListAllPools returned 0; keeping stale cache.");
    return bagsMintCache.set;
  }
  const set = new Set(pools.map((p) => p.tokenMint));
  bagsMintCache = { set, fetchedAt: now };
  console.log(`[NarrativePipeline] cached ${set.size} Bags pool mints`);
  return set;
}


const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/**
 * Shape both Claude and Gemini are asked to return.
 *
 * `search_terms` are short queries (1-3 words each) we'll feed into Bags' search.
 * They should be a mix of:
 *   - Explicit token names/tickers if the tweet names any (highest weight).
 *   - Thematic keywords that capture the narrative even if no token is named
 *     (e.g. "AI agent", "RWA", "memecoin", "Solana DeFi").
 * The goal is to surface tokens on Bags that ALIGN with the tweet, not just ones
 * the tweet literally mentions.
 */
type NarrativeExtraction = {
  narrative: string;
  tickers: Array<{ ticker: string; weight: number; reason?: string }>;
  nouns: Array<{ noun: string; weight: number; reason?: string }>;
};

const SYSTEM_PROMPT =
  "You are a degen Solana memecoin discovery agent. You analyze tweets to extract ticker candidates and noun keywords. In memecoin culture ANY word can be a token — verbs, slang, single letters, names, vibes. Do NOT filter for 'crypto relevance'.";

const USER_PROMPT = (content: string, creatorHandle?: string): string =>
  `Tweet: "${content}"
${creatorHandle ? `Creator: @${creatorHandle}` : ""}

Your job:
1. Generate the TOP 5 most probable Solana memecoin tickers that either already exist or could be created based on this tweet.
   - Think like a degen: consider exact phrases, acronyms, the poster's name combined with keywords, single strong nouns, and any numbers or symbols.
   - Rank by how likely a memecoin community would actually use them.
   - Return ONLY the tickers (uppercase, 1-3 words), ranked.

2. Separately identify ALL nouns in the tweet. Nouns are the highest priority for memecoin naming.
   - List them separately from tickers so they can be weighted higher in search.
   - A noun that is also a ticker candidate should appear in both lists.
   - Identify compound nouns (e.g., "AI agent").

Return JSON only:
{
  "narrative": "1-sentence literal summary of the tweet",
  "tickers": [
    { "ticker": "TICKER", "weight": 95, "reason": "main subject" },
    ...
  ],
  "nouns": [
    { "noun": "noun", "weight": 100, "reason": "primary noun" },
    ...
  ]
}`;

/** Strip ```json fences if a model wrapped its output. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Claude 3 Haiku — primary provider when ANTHROPIC_API_KEY has credits. */
async function extractWithClaude(content: string, creatorHandle?: string): Promise<NarrativeExtraction> {
  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_PROMPT(content, creatorHandle) }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return JSON.parse(stripJsonFences(text)) as NarrativeExtraction;
}

/** Transient HTTP statuses worth retrying with backoff. */
const TRANSIENT_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Comma-separated env var, e.g. "gemini-2.5-flash,gemini-2.5-flash-lite". */
function geminiModelChain(): string[] {
  const env = process.env.GEMINI_MODEL?.trim();
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  // Default chain: Flash first, then Lite as overload fallback.
  return ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
}

async function callGeminiOnce(
  model: string,
  apiKey: string,
  content: string,
  creatorHandle?: string,
): Promise<NarrativeExtraction> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: USER_PROMPT(content, creatorHandle) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 1000,
      temperature: 0.4,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty response");
  return JSON.parse(stripJsonFences(text)) as NarrativeExtraction;
}

/**
 * Gemini via REST with retry + model-chain fallback.
 * - Retries the same model with exponential backoff on transient errors (503/429/etc).
 * - If retries are exhausted, advances to the next model in GEMINI_MODEL chain.
 * Default chain: gemini-2.5-flash → gemini-2.5-flash-lite.
 */
async function extractWithGemini(content: string, creatorHandle?: string): Promise<NarrativeExtraction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const models = geminiModelChain();
  const RETRIES_PER_MODEL = 2;
  let lastErr: unknown = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        return await callGeminiOnce(model, apiKey, content, creatorHandle);
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        const transient = status !== undefined && TRANSIENT_GEMINI_STATUSES.has(status);
        if (!transient) break; // permanent error — try next model immediately
        if (attempt < RETRIES_PER_MODEL) {
          const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s
          console.warn(
            `[Gemini] ${model} transient ${status}, retry ${attempt + 1}/${RETRIES_PER_MODEL} in ${backoffMs}ms`,
          );
          await sleep(backoffMs);
        }
      }
    }
    console.warn(`[Gemini] ${model} exhausted, trying next model in chain.`);
  }

  throw lastErr instanceof Error ? lastErr : new Error("Gemini failed (all models)");
}

/** True for Anthropic errors that mean "switch provider, don't retry Claude". */
function isClaudeUnusable(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  if (!e) return false;
  const msg = (e.message ?? "").toLowerCase();
  if (e.status === 401 || e.status === 403) return true;
  if (e.status === 400 && msg.includes("credit balance")) return true;
  if (msg.includes("api key") && msg.includes("invalid")) return true;
  return false;
}

/**
 * Extracts narrative concepts. Tries Claude first; falls back to Gemini when
 * Claude is unconfigured, out of credits, or returns an auth error.
 * Returns null if both providers are unavailable.
 */
async function extractNarrativeConcepts(
  content: string,
  creatorHandle?: string,
): Promise<NarrativeExtraction | null> {
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (!hasClaude && !hasGemini) {
    throw new Error("No AI provider configured: set ANTHROPIC_API_KEY or GEMINI_API_KEY");
  }

  if (hasClaude) {
    try {
      return await extractWithClaude(content, creatorHandle);
    } catch (err) {
      if (isClaudeUnusable(err)) {
        if (hasGemini) {
          console.warn(
            "[NarrativePipeline] Claude unavailable (credits/auth) — falling back to Gemini.",
          );
        } else {
          console.warn(
            "[NarrativePipeline] Paused: Claude unusable and GEMINI_API_KEY not set.",
          );
          return null;
        }
      } else if (!hasGemini) {
        throw err;
      } else {
        console.warn("[NarrativePipeline] Claude error, trying Gemini:", err);
      }
    }
  }

  // Gemini path (either primary if no Claude, or fallback after Claude failure).
  return await extractWithGemini(content, creatorHandle);
}

/** Pull a string from any of the candidate keys; defensive for Bags' inconsistent shape. */
function pickStr(o: unknown, ...keys: string[]): string | null {
  if (!o || typeof o !== "object") return null;
  const obj = o as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

type StoredMatch = {
  tweet_id: string;
  token_mint: string;
  token_name: string | null;
  token_ticker: string | null;
  match_score: number;
  score: number;
  is_on_bags: boolean;
  narrative: string | null;
  logo_url: string | null;
};

/** Normalized result shape so the matching loop is provider-agnostic. */
type SearchHit = {
  mint: string;
  name: string | null;
  symbol: string;
  quality: number;
  // Optional Jupiter-native signals (only set when source is Jupiter).
  verified?: boolean;
  organicScore?: number;
};

/**
 * Search Jupiter's lite token-search API for a query string.
 * Returns up to MAX_RESULTS_PER_TERM candidates, ranked by Jupiter's organic score.
 * Skips obvious junk: unverified tokens, tokens with no name/symbol.
 *
 * Bags has no public search endpoint — Jupiter is the only viable source for
 * name-based Solana token discovery.
 */
async function jupiterSearchTokens(query: string): Promise<SearchHit[]> {
  try {
    const url = `${JUPITER_SEARCH_URL}?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[jupiter-search] "${query}" → HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];

    // Keep Jupiter's default relevance order. Sorting by verified/organicScore
    // pushes Bags memecoins (usually unverified, low organic) off the list,
    // which defeats the whole point of the Bags filter we apply downstream.
    return data
      .map<SearchHit | null>((r) => {
        const mint = pickStr(r, "id", "mint", "address");
        const name = pickStr(r, "name");
        const symbol = pickStr(r, "symbol", "ticker");
        const verified = r.isVerified === true;
        const organic = Number(r.organicScore ?? 0);
        if (!mint || !symbol) return null;
        // Quality is kept as a tiebreaker signal for downstream scoring,
        // but we no longer use it to filter or reorder Jupiter's results.
        const quality = (verified ? 50 : 0) + Math.min(50, Math.max(0, organic));
        return { mint, name, symbol, quality, verified, organicScore: organic };
      })
      .filter((x): x is SearchHit => x !== null)
      .slice(0, MAX_RESULTS_PER_TERM);
  } catch (e) {
    console.warn(`[jupiter-search] "${query}" failed:`, e);
    return [];
  }
}

import { bagsGetPoolByMint } from "./bagsClient";

/**
 * Three-step token search:
 *   Step 1 — Bags-confirmed tokens (feed cache + Jupiter filtered by Bags mints)
 *            → is_on_bags = true, priority slots
 *   Step 2 — Jupiter-only tokens (not on Bags) fill remaining slots up to 10
 *            → is_on_bags = false
 *   Step 3 — Rank all 10 by score (AI weight + quality boost)
 *
 * Dedupes by tokenMint across all sources.
 */
async function searchAndScoreTokens(
  tweet_id: string,
  tickers: NarrativeExtraction["tickers"],
  nouns: NarrativeExtraction["nouns"],
  narrative: string,
): Promise<StoredMatch[]> {
  const combined = [
    ...tickers.map((t) => ({ term: t.ticker, weight: t.weight, reason: t.reason })),
    ...nouns.map((n) => ({ term: n.noun, weight: n.weight * 0.8, reason: n.reason })),
  ]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 7);

  if (combined.length === 0) {
    console.log(`[NarrativePipeline] tweet ${tweet_id}: AI returned no search terms.`);
    return [];
  }

  // ── Phase 1: Collect Bags-confirmed and Jupiter-only tokens ──
  const bagsMatches = new Map<string, StoredMatch>();
  const jupiterOnlyMatches = new Map<string, StoredMatch & { rawQuality: number }>();

  // Limit how many term searches we fire so a chatty AI doesn't burn quota.
  console.log(
    `[NarrativePipeline] tweet ${tweet_id} terms:`,
    combined.map((t) => `"${t.term}" (${t.weight})`).join(", "),
  );

  // Lazy-load the Bags mint set only if we need Jupiter fallback.
  let bagsMints: Set<string> | null = null;

  let firstJupiterCall = true;
  for (const t of combined) {
    const q = (t.term || "").trim();
    if (!q) continue;

    const aiScore = Math.max(0, Math.min(100, Number(t.weight) || 0));

    // ── Source 1: Feed cache (instant, all results are confirmed Bags tokens)
    const feedHits = searchFeedCache(q);
    if (feedHits.length > 0) {
      console.log(
        `[NarrativePipeline] feed cache hit "${q}" → ${feedHits.length} results`,
      );
    }
    for (const h of feedHits) {
      if (bagsMatches.has(h.mint)) continue;
      
      let finalScore = 50;
      try {
        const pool = await bagsGetPoolByMint(h.mint);
        if (pool) {
          const stats = (pool as any).pool || pool;
          finalScore = calculateScratchScore({
            mcap: stats.marketCapUsd || stats.mcap || 0,
            volume24h: stats.volume24hUsd || stats.volume24h || 0,
            liquidity: stats.liquidityUsd || stats.liquidity || 0,
            holders: stats.holders || stats.holderCount || 0,
            lifecycle: stats.lifecycle || 'PRE_LAUNCH',
            twitter: stats.twitter,
            telegram: stats.telegram,
            website: stats.website,
            returns: stats.returns24h || stats.change24h
          });
        }
      } catch (e) {
        console.error(`[NarrativePipeline] Scoring failed for ${h.mint}:`, e);
      }

      const matchScore = Math.min(100, Math.round(aiScore + (h.quality + 10) / 4));
      bagsMatches.set(h.mint, {
        tweet_id,
        token_mint: h.mint,
        token_name: h.name,
        token_ticker: h.symbol,
        match_score: matchScore,
        score: finalScore,
        is_on_bags: true,
        narrative,
        logo_url: null,
      });
    }

    // ── Source 2: Jupiter (always search; split into Bags-confirmed and Jupiter-only)
    // Lazy-load the mint set on first Jupiter call.
    if (!bagsMints) {
      bagsMints = await getBagsMintSet();
      if (bagsMints.size === 0) {
        console.warn(`[NarrativePipeline] Bags pool list empty — all Jupiter hits will be Jupiter-only.`);
      }
    }

    if (!firstJupiterCall) await sleep(SEARCH_DELAY_MS);
    firstJupiterCall = false;

    const hits = await jupiterSearchTokens(q);
    const onBags = bagsMints.size > 0 ? hits.filter((h) => bagsMints!.has(h.mint)) : [];
    const offBags = bagsMints.size > 0 ? hits.filter((h) => !bagsMints!.has(h.mint)) : hits;

    console.log(
      `[NarrativePipeline] jupiter "${q}" → ${hits.length} total, ${onBags.length} on Bags, ${offBags.length} off Bags`,
    );

    for (const h of onBags) {
      if (bagsMatches.has(h.mint)) continue;
      
      let finalScore = 50;
      try {
        const pool = await bagsGetPoolByMint(h.mint);
        if (pool) {
          const stats = (pool as any).pool || pool;
          finalScore = calculateScratchScore({
            mcap: stats.marketCapUsd || stats.mcap || 0,
            volume24h: stats.volume24hUsd || stats.volume24h || 0,
            liquidity: stats.liquidityUsd || stats.liquidity || 0,
            holders: stats.holders || stats.holderCount || 0,
            lifecycle: stats.lifecycle || 'PRE_LAUNCH',
            twitter: stats.twitter,
            telegram: stats.telegram,
            website: stats.website,
            returns: stats.returns24h || stats.change24h
          });
        }
      } catch (e) {
        console.error(`[NarrativePipeline] Scoring failed for ${h.mint}:`, e);
      }

      const matchScore = Math.min(100, Math.round(aiScore + h.quality / 4));
      bagsMatches.set(h.mint, {
        tweet_id,
        token_mint: h.mint,
        token_name: h.name,
        token_ticker: h.symbol,
        match_score: matchScore,
        score: finalScore,
        is_on_bags: true,
        narrative,
        logo_url: null,
      });
    }

    for (const h of offBags) {
      if (bagsMatches.has(h.mint) || jupiterOnlyMatches.has(h.mint)) continue;
      // Score Jupiter-only tokens through the unified formula. Without market
      // data at insert time we lean on Jupiter's verified + organicScore
      // signals; the cron will re-score later once mcap/volume/holders are
      // populated.
      const jupScore = calculateScratchScore({
        mcap: 0,
        volume24h: 0,
        liquidity: 0,
        holders: 0,
        jupiterVerified: h.verified === true,
        jupiterOrganicScore: h.organicScore,
      });
      const matchScore = Math.min(100, Math.round(aiScore + h.quality / 4));
      jupiterOnlyMatches.set(h.mint, {
        tweet_id,
        token_mint: h.mint,
        token_name: h.name,
        token_ticker: h.symbol,
        match_score: matchScore,
        score: jupScore,
        is_on_bags: false,
        rawQuality: h.quality,
        narrative,
        logo_url: null,
      });
    }
  }

  // ── Phase 2: Assemble final list ─────────────────────────────
  // Start with Bags-confirmed, sorted by score descending.
  const bagsList = Array.from(bagsMatches.values()).sort((a, b) => b.match_score - a.match_score);

  // If we have fewer than 10 Bags tokens, fill remaining slots with Jupiter-only.
  let final: StoredMatch[] = [...bagsList];
  if (final.length < MAX_TOKENS_TO_STORE) {
    const needed = MAX_TOKENS_TO_STORE - final.length;
    const jupiterList = Array.from(jupiterOnlyMatches.values())
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, needed)
      .map(({ rawQuality: _, ...match }) => match); // strip rawQuality
    final.push(...jupiterList);
  }

  // Re-sort everything by score so Bags tokens naturally bubble to the top.
  final = final.sort((a, b) => b.match_score - a.match_score).slice(0, MAX_TOKENS_TO_STORE);

  const bagsCount = final.filter((m) => m.is_on_bags).length;
  const jupiterCount = final.length - bagsCount;
  console.log(
    `[NarrativePipeline] Processed tweet ${tweet_id}: ${bagsCount} on Bags + ${jupiterCount} Jupiter = ${final.length} tokens stored`,
  );

  return final;
}


export async function runNarrativePipeline({
  tweet_id,
  content,
  creator_handle,
}: {
  tweet_id: string;
  content: string;
  creator_handle?: string;
}) {
  try {
    const result = await extractNarrativeConcepts(content, creator_handle);
    if (!result) return; // Silent exit if no provider available

    // 1. Save the narrative summary on the tweet.
    if (result.narrative) {
      await supabase
        .from("tweets")
        .update({ narrative: result.narrative })
        .eq("tweet_id", tweet_id);
    }

    // 2. Match the AI's candidate tokens against the Bags catalog.
    const matches = await searchAndScoreTokens(tweet_id, result.tickers || [], result.nouns || [], result.narrative || "");

    // 3. Store the top matches so the feed UI can render them.
    //    ignoreDuplicates so we don't clobber rows from earlier tweets that
    //    already mentioned the same mint (token_mint has a UNIQUE constraint).
    if (matches.length > 0) {
      const { error: upsertErr } = await supabase
        .from("narrative_tokens")
        .upsert(matches, { onConflict: "tweet_id,token_mint" });
      if (upsertErr) {
        console.warn(`[NarrativePipeline] narrative_tokens upsert error:`, upsertErr);
      }
    }
  } catch (err) {
    // Only log real errors, not the credit warning we handled above
    if (!(err instanceof Error && err.message.includes("credit balance"))) {
      console.error(`[NarrativePipeline] Error for tweet ${tweet_id}:`, err);
    }
  }
}
