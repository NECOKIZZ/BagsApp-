
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
import { bagsConfigured, bagsSearchTokens } from "./bagsClient";

// How many of the AI's candidate token names we actually search on Bags.
// Lower = fewer Bags calls per tweet. 3 covers most useful cases.
const MAX_CANDIDATES_TO_SEARCH = 3;
const MAX_TOKENS_TO_STORE = 10;
// Delay between Bags search calls within a single tweet (be a polite client).
const BAGS_SEARCH_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/** Shape both Claude and Gemini are asked to return. */
type NarrativeExtraction = {
  narrative: string;
  tokens: Array<{ name: string; ticker: string; match_score: number }>;
};

const SYSTEM_PROMPT =
  "You are a crypto narrative expert. Analyze the tweet and identify the core narrative and any mentioned tokens.";

const USER_PROMPT = (content: string): string =>
  `Analyze this tweet: "${content}"\n\nReturn JSON only (no markdown fences): { "narrative": "...", "tokens": [{ "name": "...", "ticker": "...", "match_score": 0-100 }] }`;

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

/**
 * Gemini 2.5 Flash via REST. Free tier: 250 req/day, 10 RPM.
 * Uses responseMimeType=application/json so the model returns parseable JSON.
 */
async function extractWithGemini(content: string): Promise<NarrativeExtraction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
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
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty response");
  return JSON.parse(stripJsonFences(text)) as NarrativeExtraction;
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

/**
 * Search Bags for each AI-suggested token name, dedupe by mint, score, take top N.
 * Score is the AI's confidence (0-100) for the candidate that surfaced this match.
 */
async function searchAndScoreTokens(
  tweet_id: string,
  candidates: NarrativeExtraction["tokens"],
): Promise<
  Array<{
    tweet_id: string;
    token_mint: string;
    token_name: string | null;
    token_ticker: string | null;
    match_score: number;
    score: number;
  }>
> {
  if (!bagsConfigured()) {
    console.warn("[NarrativePipeline] BAGS_API_KEY not set — skipping token search.");
    return [];
  }
  if (!candidates || candidates.length === 0) return [];

  const seen = new Map<
    string,
    {
      tweet_id: string;
      token_mint: string;
      token_name: string | null;
      token_ticker: string | null;
      match_score: number;
      score: number;
    }
  >();

  // Limit how many candidate searches we fire so a chatty AI doesn't burn API quota.
  const top = candidates.slice(0, MAX_CANDIDATES_TO_SEARCH);
  console.log(
    `[NarrativePipeline] tweet ${tweet_id} candidates:`,
    top.map((c) => `${c.name || c.ticker} (${c.match_score})`).join(", ") || "none",
  );

  let firstCall = true;
  for (const cand of top) {
    const q = (cand.name || cand.ticker || "").trim();
    if (!q) continue;

    // Pace Bags calls so we don't burst the API on tweets with many candidates.
    if (!firstCall) await sleep(BAGS_SEARCH_DELAY_MS);
    firstCall = false;

    const results = await bagsSearchTokens(q);
    console.log(`[NarrativePipeline]   bags search "${q}" → ${results.length} results`);
    const aiScore = Math.max(0, Math.min(100, Number(cand.match_score) || 0));

    for (const r of results) {
      const mint = pickStr(r, "tokenMint", "token_mint", "mint");
      if (!mint) continue;
      // First match for this mint wins; later candidates don't overwrite.
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
    const matches = await searchAndScoreTokens(tweet_id, result.tokens ?? []);

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
