
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
import { bagsGetPoolByMint, bagsSearchTokens } from "./bagsClient";
import { calculateScratchScore } from "./scoring";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Types ---

export interface ExtractionResult {
  entities: string[];
  keywords: string[];
  ticker_aliases: string[];
  themes: string[];
  sentiment: "bullish" | "bearish" | "neutral" | "hype";
  narrative_strength: number;
}

export interface ScoredToken {
  token_name: string;
  token_ticker: string;
  token_mint: string;
  match_score: number;
  launched_at: string;
}

// --- Stage 1: Claude Extraction (using Haiku for cost efficiency) ---

const EXTRACTION_SYSTEM_PROMPT = `
You are a crypto narrative analyst. Given a tweet, extract structured data to help match it to relevant Solana meme tokens.
Focus on identifying the top 10 most likely tickers (3-6 characters) that degens will launch or trade in response to this tweet.

Return ONLY a valid JSON object. No preamble, no markdown, no explanation.

Schema:
{
  "entities": string[],        // Named people, orgs, places (e.g. ["Elon Musk", "Federal Reserve"])
  "keywords": string[],        // Core topics as single words (e.g. ["rates", "doge"])
  "ticker_aliases": string[],  // TOP 10 predicted tickers (e.g. ["POWELL", "FED", "DOGE"])
  "themes": string[],          // Broader themes (e.g. ["political", "macro", "animal"])
  "sentiment": "bullish" | "bearish" | "neutral" | "hype",
  "narrative_strength": number // 0-100: how likely is this tweet to drive a token narrative?
}
`;

export async function extractNarrativeConcepts(
  tweetContent: string
): Promise<ExtractionResult | null> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('REPLACE_ME')) {
    console.warn("[NarrativePipeline] ANTHROPIC_API_KEY not configured. Skipping extraction.");
    return null;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Tweet: "${tweetContent}"` },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as ExtractionResult;
  } catch (err) {
    console.error("[NarrativePipeline] Claude extraction failed:", err);
    return null;
  }
}

// --- Stage 2: Token Relevance Scoring ---

function tickerScore(ticker: string, extraction: ExtractionResult): number {
  const t = ticker.toUpperCase();
  if (extraction.ticker_aliases.includes(t)) return 1.0;
  const partialMatch = extraction.ticker_aliases.some(
    (a) => t.includes(a) || a.includes(t)
  );
  if (partialMatch) return 0.6;
  const kwMatch = extraction.keywords.some(
    (k) => t.includes(k.toUpperCase()) || k.toUpperCase().includes(t)
  );
  if (kwMatch) return 0.4;
  return 0.0;
}

function nameScore(tokenName: string, extraction: ExtractionResult): number {
  const name = tokenName.toLowerCase();
  const entityMatch = extraction.entities.some((e) =>
    name.includes(e.toLowerCase().split(" ")[0])
  );
  if (entityMatch) return 1.0;
  const kwMatch = extraction.keywords.filter((k) =>
    name.includes(k.toLowerCase())
  ).length;
  return Math.min(kwMatch * 0.3, 1.0);
}

function themeScore(tokenName: string, themes: string[]): number {
  const themeKeywordMap: Record<string, string[]> = {
    animal: ["dog", "cat", "pepe", "frog", "ape", "bear", "bull", "bird"],
    political: ["trump", "biden", "usa", "america", "potus", "gov", "house"],
    ai: ["ai", "gpt", "llm", "robot", "agent", "brain"],
    macro: ["fed", "rate", "bond", "gold", "dollar", "inflation"],
  };
  const name = tokenName.toLowerCase();
  let maxScore = 0;
  for (const theme of themes) {
    const themeWords = themeKeywordMap[theme.toLowerCase()] ?? [];
    if (themeWords.some((w) => name.includes(w))) {
      maxScore = Math.max(maxScore, 1.0);
    }
  }
  return maxScore;
}

export function calculateMatchScore(
  token: { token_name: string; token_ticker: string },
  extraction: ExtractionResult
): number {
  const ts = tickerScore(token.token_ticker, extraction);
  const ns = nameScore(token.token_name, extraction);
  const th = themeScore(token.token_name, extraction.themes);
  const raw = ts * 0.5 + ns * 0.35 + th * 0.15;
  return Math.round(raw * 100);
}

// --- Orchestrator ---

export async function runNarrativePipeline(tweet: {
  tweet_id: string;
  content: string;
}): Promise<void> {
  const extraction = await extractNarrativeConcepts(tweet.content);
  if (!extraction) return;

  // Signal threshold
  if (extraction.narrative_strength < 30) {
    console.log(`[NarrativePipeline] Low strength (${extraction.narrative_strength}) for tweet ${tweet.tweet_id}. Skipping.`);
    return;
  }

  // Optimized Search: Parallelize the top 4 aliases
  const searchTerms = extraction.ticker_aliases.slice(0, 4);
  console.log(`[NarrativePipeline] Searching Bags for: ${searchTerms.join(", ")}`);

  try {
    const searchResults = await Promise.all(
      searchTerms.map(term => bagsSearchTokens(term))
    );

    const rawCandidates = searchResults.flat();
    
    // Deduplicate by mint and ensure liquidity/volume exists
    const seenMints = new Set<string>();
    const candidates = rawCandidates.filter(c => {
      if (!c.token_mint || seenMints.has(c.token_mint)) return false;
      seenMints.add(c.token_mint);
      return true;
    });

    // Score all unique candidates
    const scored = candidates
      .map(c => ({
        token_name: c.token_name || "Unknown",
        token_ticker: c.token_ticker || "UNKNOWN",
        token_mint: c.token_mint,
        match_score: calculateMatchScore(c as any, extraction),
        launched_at: c.launched_at || new Date().toISOString()
      }))
      .filter(c => c.match_score > 20) // Filter out noise
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 5); // Keep top 5

    if (scored.length === 0) {
      console.log(`[NarrativePipeline] No high-match tokens found for tweet ${tweet.tweet_id}`);
      return;
    }

    // Upsert into narrative_tokens
    for (const token of scored) {
      await supabase.from("narrative_tokens").upsert(
        {
          tweet_id: tweet.tweet_id,
          token_name: token.token_name,
          token_ticker: token.token_ticker,
          token_mint: token.token_mint,
          match_score: token.match_score,
          launched_at: token.launched_at,
          // Note: score (scratch_score) will be populated by the stats refresher
        },
        { onConflict: "tweet_id,token_ticker" }
      );
    }

    console.log(`[NarrativePipeline] Successfully linked ${scored.length} tokens to tweet ${tweet.tweet_id}`);
  } catch (err) {
    console.error("[NarrativePipeline] Search/Upsert stage failed:", err);
  }
}
