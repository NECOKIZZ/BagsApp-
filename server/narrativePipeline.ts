
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
import { bagsListAllPools } from "./bagsClient";

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

const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";

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
  search_terms: Array<{ term: string; weight: number; reason?: string }>;
};

const SYSTEM_PROMPT =
  "You analyze tweets to surface candidate Solana memecoins on Bags.fm. In memecoin culture ANY word can be a token — common verbs, slang, single letters, names, vibes. Do NOT filter for 'crypto relevance'.";

const USER_PROMPT = (content: string): string =>
  `Tweet: "${content}"

Your job:
1. Write a 1-sentence narrative summary of what the tweet is about (literal, not crypto-coded).
2. Produce 4-5 SEARCH TERMS (1-2 words each) that could plausibly exist as a memecoin name on Bags.
   - Pull standout nouns, verbs, slang, names, vibe-words, hashtags, repeated phrases.
   - "gm", "going", "trend", "agent", "moon", "am", "grok", "fartcoin" — all valid token names.
   - If the tweet explicitly names a token (cashtag like $BONK or "BONK is mooning"), list it FIRST with weight 95.
   - Otherwise extract the 4-5 most distinctive words/phrases from the tweet itself.
   - Even short tweets like "gm" should produce at least one term: ["gm"].
   - Single-word terms preferred. 2-word phrases only if they're a clear unit ("AI agent", "to the moon").
   - Order by how distinctive/searchable each term is. Higher weight = more likely to be a real token someone made.
   - 'reason' is a brief note (e.g. "main verb of tweet", "noun subject", "named cashtag").

Return JSON only (no markdown fences):
{
  "narrative": "...",
  "search_terms": [
    { "term": "going", "weight": 70, "reason": "main verb, vibe word" },
    { "term": "trend", "weight": 65, "reason": "noun subject" }
  ]
}`;

/** Strip ```json fences if a model wrapped its output. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Claude 3 Haiku — primary provider when ANTHROPIC_API_KEY has credits. */
async function extractWithClaude(content: string): Promise<NarrativeExtraction> {
  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_PROMPT(content) }],
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
): Promise<NarrativeExtraction> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: USER_PROMPT(content) }] }],
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
async function extractWithGemini(content: string): Promise<NarrativeExtraction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const models = geminiModelChain();
  const RETRIES_PER_MODEL = 2;
  let lastErr: unknown = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        return await callGeminiOnce(model, apiKey, content);
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
): Promise<NarrativeExtraction | null> {
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (!hasClaude && !hasGemini) {
    throw new Error("No AI provider configured: set ANTHROPIC_API_KEY or GEMINI_API_KEY");
  }

  if (hasClaude) {
    try {
      return await extractWithClaude(content);
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
  return await extractWithGemini(content);
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
};

/** Normalized result shape so the matching loop is provider-agnostic. */
type SearchHit = { mint: string; name: string | null; symbol: string; quality: number };

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
      .map((r) => {
        const mint = pickStr(r, "id", "mint", "address");
        const name = pickStr(r, "name");
        const symbol = pickStr(r, "symbol", "ticker");
        const verified = r.isVerified === true;
        const organic = Number(r.organicScore ?? 0);
        if (!mint || !symbol) return null;
        // Quality is kept as a tiebreaker signal for downstream scoring,
        // but we no longer use it to filter or reorder Jupiter's results.
        const quality = (verified ? 50 : 0) + Math.min(50, Math.max(0, organic));
        return { mint, name, symbol, quality };
      })
      .filter((x): x is SearchHit => x !== null)
      .slice(0, MAX_RESULTS_PER_TERM);
  } catch (e) {
    console.warn(`[jupiter-search] "${query}" failed:`, e);
    return [];
  }
}

/**
 * Run each AI search term through Jupiter, dedupe by mint, take top N by score.
 * A token's score is the AI's weight for the FIRST term that surfaced it,
 * boosted slightly by Jupiter's quality signal.
 */
async function searchAndScoreTokens(
  tweet_id: string,
  searchTerms: NarrativeExtraction["search_terms"],
): Promise<StoredMatch[]> {
  if (!searchTerms || searchTerms.length === 0) {
    console.log(`[NarrativePipeline] tweet ${tweet_id}: AI returned no search terms.`);
    return [];
  }

  // Cached set of all Bags pool mints. Jupiter hits not in this set are dropped
  // so we only ever surface tokens that actually exist on the Bags platform.
  const bagsMints = await getBagsMintSet();
  if (bagsMints.size === 0) {
    console.warn(`[NarrativePipeline] Bags pool list empty — cannot filter, skipping search.`);
    return [];
  }

  const seen = new Map<string, StoredMatch>();

  // Limit how many term searches we fire so a chatty AI doesn't burn quota.
  const top = searchTerms.slice(0, MAX_CANDIDATES_TO_SEARCH);
  console.log(
    `[NarrativePipeline] tweet ${tweet_id} terms:`,
    top.map((t) => `"${t.term}" (${t.weight})`).join(", "),
  );

  let firstCall = true;
  for (const t of top) {
    const q = (t.term || "").trim();
    if (!q) continue;

    if (!firstCall) await sleep(SEARCH_DELAY_MS);
    firstCall = false;

    const hits = await jupiterSearchTokens(q);
    const onBags = hits.filter((h) => bagsMints.has(h.mint));
    console.log(
      `[NarrativePipeline]   jupiter "${q}" → ${hits.length} results, ${onBags.length} on Bags`,
    );
    const aiScore = Math.max(0, Math.min(100, Number(t.weight) || 0));

    for (const h of onBags) {
      // First match for this mint wins (terms are ordered by relevance).
      if (seen.has(h.mint)) continue;
      // Final score = AI confidence (0-100) gently nudged by token quality (0-100, /4).
      const finalScore = Math.min(100, Math.round(aiScore + h.quality / 4));
      seen.set(h.mint, {
        tweet_id,
        token_mint: h.mint,
        token_name: h.name,
        token_ticker: h.symbol,
        match_score: finalScore,
        score: finalScore,
      });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, MAX_TOKENS_TO_STORE);
}

export async function runNarrativePipeline({
  tweet_id,
  content,
}: {
  tweet_id: string;
  content: string;
}) {
  try {
    const result = await extractNarrativeConcepts(content);
    if (!result) return; // Silent exit if no provider available

    // 1. Save the narrative summary on the tweet.
    if (result.narrative) {
      await supabase
        .from("tweets")
        .update({ narrative: result.narrative })
        .eq("tweet_id", tweet_id);
    }

    // 2. Match the AI's candidate tokens against the Bags catalog.
    const matches = await searchAndScoreTokens(tweet_id, result.search_terms ?? []);

    // 3. Store the top matches so the feed UI can render them.
    //    ignoreDuplicates so we don't clobber rows from earlier tweets that
    //    already mentioned the same mint (token_mint has a UNIQUE constraint).
    if (matches.length > 0) {
      const { error: upsertErr } = await supabase
        .from("narrative_tokens")
        .upsert(matches, { onConflict: "token_mint", ignoreDuplicates: true });
      if (upsertErr) {
        console.warn(`[NarrativePipeline] narrative_tokens upsert error:`, upsertErr);
      }
    }

    console.log(
      `[NarrativePipeline] Processed tweet ${tweet_id}: ${matches.length} tokens stored`,
    );
  } catch (err) {
    // Only log real errors, not the credit warning we handled above
    if (!(err instanceof Error && err.message.includes("credit balance"))) {
      console.error(`[NarrativePipeline] Error for tweet ${tweet_id}:`, err);
    }
  }
}
