
-- Migration to support high-fidelity market terminal and degen discovery
-- Run in Supabase SQL editor

-- Add logo_url and narrative columns to narrative_tokens
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS logo_url text DEFAULT NULL;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS narrative text DEFAULT NULL;

-- Create index for faster narrative filtering
CREATE INDEX IF NOT EXISTS narrative_tokens_narrative_idx ON public.narrative_tokens (narrative);

-- Update existing rows to have narrative if they were linked to a tweet
UPDATE public.narrative_tokens nt
SET narrative = t.narrative
FROM public.tweets t
WHERE nt.tweet_id = t.tweet_id
AND nt.narrative IS NULL;
