
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/**
 * Extracts narrative concepts from a tweet using Claude 3 Haiku.
 */
async function extractNarrativeConcepts(content: string) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing");
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      system: "You are a crypto narrative expert. Analyze the tweet and identify the core narrative and any mentioned tokens.",
      messages: [
        {
          role: "user",
          content: `Analyze this tweet: "${content}"\n\nReturn JSON: { "narrative": "...", "tokens": [{ "name": "...", "ticker": "...", "match_score": 0-100 }] }`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text);
  } catch (err: any) {
    // Graceful handling of credit balance issues to prevent log spam
    if (err?.status === 400 && err?.message?.includes("credit balance")) {
      console.warn("[NarrativePipeline] Paused: Anthropic account has $0.00 credits. Please top up to enable AI extraction.");
      return null; // Return null so we don't try to process further
    }
    throw err;
  }
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
