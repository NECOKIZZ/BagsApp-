
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";

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

export async function runNarrativePipeline({
  tweet_id,
  content,
}: {
  tweet_id: string;
  content: string;
}) {
  try {
    const result = await extractNarrativeConcepts(content);
    if (!result) return; // Silent exit if credits are empty

    // Update the tweet with narrative if we got a result
    if (result.narrative) {
      await supabase
        .from("tweets")
        .update({ narrative: result.narrative })
        .eq("tweet_id", tweet_id);
    }

    // Process tokens... (rest of your logic)
    console.log(`[NarrativePipeline] Processed tweet ${tweet_id}`);
  } catch (err) {
    // Only log real errors, not the credit warning we handled above
    if (!(err instanceof Error && err.message.includes("credit balance"))) {
      console.error(`[NarrativePipeline] Error for tweet ${tweet_id}:`, err);
    }
  }
}
