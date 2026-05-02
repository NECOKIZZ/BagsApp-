
-- Run in Supabase SQL editor to enable the Scratch Score system.

-- 1. Add scoring columns to narrative_tokens
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS score integer DEFAULT 0;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS top1_holder_pct numeric DEFAULT NULL;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS top5_holder_pct numeric DEFAULT NULL;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS concentration_flag boolean DEFAULT false;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS liquidity numeric DEFAULT NULL;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS holders integer DEFAULT NULL;
ALTER TABLE public.narrative_tokens ADD COLUMN IF NOT EXISTS lifecycle text DEFAULT 'PRE_LAUNCH';

-- 2. Optional: Indices for faster sorting by score
CREATE INDEX IF NOT EXISTS narrative_tokens_score_idx ON public.narrative_tokens (score DESC);
CREATE INDEX IF NOT EXISTS narrative_tokens_mint_idx ON public.narrative_tokens (token_mint);

-- 3. Add columns to launches if not already there (safety check)
ALTER TABLE public.launches ADD COLUMN IF NOT EXISTS score integer DEFAULT 0;
