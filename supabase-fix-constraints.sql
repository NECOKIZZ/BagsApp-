
-- Fix narrative_tokens constraints to allow same token for different tweets
-- Run in Supabase SQL editor

-- 1. Remove the restrictive single-token constraint if it exists
ALTER TABLE public.narrative_tokens DROP CONSTRAINT IF EXISTS narrative_tokens_token_mint_key;

-- 2. Ensure we have a unique constraint on (tweet_id, token_mint)
-- This allows the same token to be associated with multiple tweets,
-- while preventing the same token from being added twice to the SAME tweet.
ALTER TABLE public.narrative_tokens DROP CONSTRAINT IF EXISTS narrative_tokens_tweet_mint_unique;
ALTER TABLE public.narrative_tokens
  ADD CONSTRAINT narrative_tokens_tweet_mint_unique
  UNIQUE (tweet_id, token_mint);

-- 3. Cleanup any orphaned or duplicate rows if necessary (optional)
-- DELETE FROM public.narrative_tokens a USING public.narrative_tokens b 
-- WHERE a.id < b.id AND a.tweet_id = b.tweet_id AND a.token_mint = b.token_mint;
