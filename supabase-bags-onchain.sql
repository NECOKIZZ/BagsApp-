-- Run in Supabase SQL editor (same project as existing tables).
-- Keeps one .env: add BAGS_API_KEY and optional BAGS_API_BASE_URL, BAGS_DEFAULT_TOKEN_IMAGE_URL.

-- Raw Bags / on-chain snapshots for analytics & future scoring (query with JSON operators).
create table if not exists public.bags_onchain_snapshots (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null,
  wallet_address text,
  token_mint text,
  event_type text not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bags_onchain_snapshots_launch_id_idx
  on public.bags_onchain_snapshots (launch_id);

create index if not exists bags_onchain_snapshots_token_mint_idx
  on public.bags_onchain_snapshots (token_mint);

create index if not exists bags_onchain_snapshots_event_type_idx
  on public.bags_onchain_snapshots (event_type);

-- Optional GIN for ad-hoc JSON queries (scores later).
create index if not exists bags_onchain_snapshots_raw_gin_idx
  on public.bags_onchain_snapshots using gin (raw);

-- Extend launches for Bags flow (ignore errors if you already applied some columns).
alter table public.launches add column if not exists narrative text;
alter table public.launches add column if not exists wallet_address text;
alter table public.launches add column if not exists token_mint text;
alter table public.launches add column if not exists metadata_uri text;
alter table public.launches add column if not exists meteora_config_key text;
alter table public.launches add column if not exists initial_buy_lamports bigint;
alter table public.launches add column if not exists bags_state jsonb;
alter table public.launches add column if not exists launch_signature text;

alter table public.bags_onchain_snapshots enable row level security;

-- No policies: only the Supabase service role (your API server) bypasses RLS and can read/write.
