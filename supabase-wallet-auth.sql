-- Run in Supabase SQL editor
-- Persistent wallet auth tables for Phantom/Solana identity

create table if not exists public.wallet_nonces (
  nonce text primary key,
  address text not null,
  message text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_nonces_address on public.wallet_nonces(address);
create index if not exists idx_wallet_nonces_expires_at on public.wallet_nonces(expires_at);

create table if not exists public.wallet_sessions (
  token text primary key,
  address text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_sessions_address on public.wallet_sessions(address);
create index if not exists idx_wallet_sessions_expires_at on public.wallet_sessions(expires_at);

-- Optional cleanup function for expired records
create or replace function public.cleanup_expired_wallet_auth()
returns void
language sql
as $$
  delete from public.wallet_nonces where expires_at < now() or used = true;
  delete from public.wallet_sessions where expires_at < now();
$$;
