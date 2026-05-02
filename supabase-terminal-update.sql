
-- Run in Supabase SQL editor to enable Semantic Narrative Matching & Terminal View.

-- 1. Add terminal-specific columns to narrative_tokens
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS launched_here boolean DEFAULT false;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 0;

-- 2. Ensure indices exist for fast terminal categorization & sorting
CREATE INDEX IF NOT EXISTS narrative_tokens_launched_at_idx ON public.narrative_tokens (launched_at DESC);
CREATE INDEX IF NOT EXISTS narrative_tokens_match_score_idx ON public.narrative_tokens (match_score DESC);

-- 3. Add UNIQUE constraint to prevent duplicate tokens per tweet
-- This is critical for the pipeline's upsert logic.
ALTER TABLE public.narrative_tokens
  DROP CONSTRAINT IF EXISTS narrative_tokens_tweet_ticker_unique;

ALTER TABLE public.narrative_tokens
  ADD CONSTRAINT narrative_tokens_tweet_ticker_unique
  UNIQUE (tweet_id, token_ticker);
