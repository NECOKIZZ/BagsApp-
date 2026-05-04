
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
import { bagsConfigured, bagsSearchTokens } from "./bagsClient";

// How many of the AI's candidate token names we actually search on Bags.
// Lower = fewer Bags calls per tweet. 3 covers most useful cases.
const MAX_CANDIDATES_TO_SEARCH = 4;
const MAX_TOKENS_TO_STORE = 10;
// Delay between Bags search calls within a single tweet (be a polite client).
const BAGS_SEARCH_DELAY_MS = 250;

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

/**
 * Run each AI search term through Bags, dedupe by mint, take top N by score.
 * A token's score is the AI's weight on the FIRST term that surfaced it
 * (terms are ordered most-relevant-first, so the first hit is the best match).
 */
async function searchAndScoreTokens(
  tweet_id: string,
  searchTerms: NarrativeExtraction["search_terms"],
): Promise<StoredMatch[]> {
  if (!bagsConfigured()) {
    console.warn("[NarrativePipeline] BAGS_API_KEY not set — skipping token search.");
    return [];
  }
  if (!searchTerms || searchTerms.length === 0) {
    console.log(`[NarrativePipeline] tweet ${tweet_id}: AI returned no search terms.`);
    return [];
  }

  const seen = new Map<string, StoredMatch>();

  // Limit how many term searches we fire so a chatty AI doesn't burn API quota.
  const top = searchTerms.slice(0, MAX_CANDIDATES_TO_SEARCH);
  console.log(
    `[NarrativePipeline] tweet ${tweet_id} terms:`,
    top.map((t) => `"${t.term}" (${t.weight})`).join(", "),
  );

  let firstCall = true;
  for (const t of top) {
    const q = (t.term || "").trim();
    if (!q) continue;

    // Pace Bags calls so we don't burst the API on tweets with many terms.
    if (!firstCall) await sleep(BAGS_SEARCH_DELAY_MS);
    firstCall = false;

    const results = await bagsSearchTokens(q);
    console.log(`[NarrativePipeline]   bags search "${q}" → ${results.length} results`);
    const aiScore = Math.max(0, Math.min(100, Number(t.weight) || 0));

    for (const r of results) {
      const mint = pickStr(r, "tokenMint", "token_mint", "mint");
      if (!mint) continue;
      // First match for this mint wins (terms are ordered by relevance).
      if (seen.has(mint)) continue;
      seen.set(mint, {
        tweet_id,
        token_mint: mint,
        token_name: pickStr(r, "name", "tokenName"),
        token_ticker: pickStr(r, "symbol", "ticker", "tokenTicker"),
        match_score: aiScore,
        score: aiScore,
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
