# Implementation Plan — Architecture Hardening

Status legend: 🔴 critical · 🟠 high · 🟡 medium · 🟢 polish

> Captured from architecture review on 2026-05-06. Functionality work takes priority; tackle this list afterwards or in parallel as time permits.

---

## Phase 0 — Today (security blockers)

### 0.1 🔴 Rotate every secret in `.env`
- File: `.env`
- Keys to rotate: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (optional), `BAGS_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `APIFY_TOKEN`, `TWITTERAPI_IO_KEY`, `TWITTERAPI_WEBHOOK_KEY`.
- Verify `.env` was never committed: `git log --all --full-history -- .env` and `git ls-files | findstr .env`. If any history hit, force-rotate and consider history rewrite.
- After rotation, restart `dev:server` and confirm `/api/health/bags` reports `bagsKeyLoaded: true` and `authOk: true`.

### 0.2 🔴 Add admin auth middleware
- File: `server/index.ts`, mount before the `/api/admin` rate limiter.
- Add env var `ADMIN_API_KEY` (long random, not the same as anything else).
- Reject any `/api/admin/*` request without `x-admin-key` matching, using `safeEqual`.
- Update `.env.example` with `ADMIN_API_KEY=`.

### 0.3 🔴 Enforce `CORS_ORIGINS` in production
- File: `server/index.ts:32-41`.
- If `process.env.NODE_ENV === "production"` and `CORS_ORIGINS` is empty, throw on boot rather than allowing all origins.

### 0.4 🔴 Apply pending Supabase migrations
```sql
ALTER TABLE narrative_tokens ADD COLUMN IF NOT EXISTS is_on_bags BOOLEAN DEFAULT false;
ALTER TABLE narrative_tokens DROP CONSTRAINT IF EXISTS narrative_tokens_tweet_ticker_unique;
CREATE INDEX IF NOT EXISTS idx_narrative_tokens_ticker ON narrative_tokens(tweet_ticker);
CREATE INDEX IF NOT EXISTS idx_narrative_tokens_tweet_id ON narrative_tokens(tweet_id);
```

---

## Phase 1 — This week (correctness + cost)

### 1.1 🟠 Fix `ignoreDuplicates` semantics
- File: `server/narrativePipeline.ts:560`.
- `ignoreDuplicates: true` silently drops updates to `is_on_bags`, score, and metadata. Switch to merge-on-conflict for the columns that should refresh; keep ignore only for immutable fields.

### 1.2 🟠 Concurrency-limit webhook fan-out
- File: `server/index.ts:1372-1393`.
- Cap parallel `runNarrativePipeline` + `fetchLinkPreview` calls at 3-5 (small semaphore or `p-limit`).
- Prevents 50-tweet webhook bursts from triggering Anthropic/Gemini/Bags 429s.

### 1.3 🟠 Paginate `bagsListAllPools`
- File: `server/bagsClient.ts:223-236`.
- Verify Bags response shape; follow cursor/offset until exhausted. Otherwise the `is_on_bags` flag silently misclassifies tokens once the catalog grows past page 1.

### 1.4 🟠 Idempotency for `/api/launches/:id/submit-tx`
- File: `server/index.ts:1010-1203`.
- Track `last_submitted_tx_signature` per launch. If the same signed tx body is replayed, return cached result instead of re-broadcasting.

### 1.5 🟠 Server-side SOL balance pre-check
- File: `server/index.ts` (`/api/launches`).
- Query RPC `getBalance` for `walletAddr` before calling Bags `create-token-info`. Surface clear error early; current generic Bags 500 is hostile.

---

## Phase 2 — This sprint (architecture)

### 2.1 🟡 Add `tsconfig.json` + CI typecheck
- Root `tsconfig.json` covering `server/` and `src/`.
- Add npm script `"typecheck": "tsc --noEmit"`.
- Wire into Railway / GitHub Actions pre-deploy.

### 2.2 🟡 Adopt `zod` for request validation
- New file: `server/schemas.ts` exporting per-route input schemas.
- Refactor each handler to `Schema.parse(req.body)` and return 400 on `ZodError`.
- Eliminates the manual `String(req.body?.x ?? "")` pattern across `server/index.ts`.

### 2.3 🟡 Split `server/index.ts` (1900 lines)
- `routes/auth.ts`, `routes/feed.ts`, `routes/launches.ts`, `routes/webhooks.ts`, `routes/admin.ts`.
- `jobs/metricsRefresh.ts`, `jobs/cleanup.ts`, `jobs/bagsRefresh.ts`.
- `services/launchService.ts` for the multi-step Bags flow.
- Centralizes auth middleware (item 0.2) and shrinks merge-conflict surface.

### 2.4 🟡 Extract `useWallet()` hook
- New file: `src/lib/useWallet.ts`.
- Move duplicated connect/disconnect/auth state from `FeedPage.tsx:106-159` and `TokenizePage.tsx:101-126`.

### 2.5 🟡 Standardize error response shape
- `{ error: { code, message, hint?, context? } }` everywhere.
- Update client `api.ts` to parse the new shape uniformly.

### 2.6 🟡 Unit tests for `searchAndScoreTokens`
- New folder: `server/__tests__/`.
- Cover: Bags-only result, Jupiter fallback fill, dedupe by mint, ticker collision, cache miss, AI weight thresholds.

### 2.7 🟡 Tighten narrative pipeline AI prompt
- File: `server/narrativePipeline.ts:139-164`.
- Add stopword list (gm/am/the/etc.) OR require AI weight ≥ 70 before falling back to Jupiter-only matches.
- Prevents the feed filling with random tokens named after common verbs.

### 2.8 🟡 Index Bags feed cache by symbol/name
- File: `server/narrativePipeline.ts:63-92`.
- Build `Map<symbolLower, Token>` and `Map<nameWordLower, Token[]>` at refresh time. Lookup is O(1) per term instead of O(N).

---

## Phase 3 — Backlog (polish, perf, UX)

### 3.1 🟢 Replace 30s feed polling with Supabase realtime
- File: `src/app/pages/FeedPage.tsx:55-63`.
- Subscribe to `tweets` and `narrative_tokens` channels; debounce re-render.

### 3.2 🟢 Rename `tokenId` → `mint` in token detail route
- Files: `src/app/routes.tsx:18`, `src/app/pages/TokenDetailPage.tsx`.
- Drop `mockTokenData` lookup or move it behind a dev flag.

### 3.3 🟢 Solana Wallet Adapter (or Phantom-only UI)
- Either commit to Phantom-only and remove the fallback in `src/lib/phantom.ts:30`, or adopt `@solana/wallet-adapter-react` properly.

### 3.4 🟢 Lazy-load `compromise` NLP
- File: `src/app/components/TweetCard.tsx`.
- ~700 KB library; either `import()` it on demand or replace with regex if usage is narrow.

### 3.5 🟢 Generate Supabase types
- `npx supabase gen types typescript --project-id <id> > server/db.types.ts`.
- Replace `any` casts in `server/index.ts:535,541,635,1774,1810`.

### 3.6 🟢 Pin Bags pool stat schema
- File: `server/index.ts:1719-1756`.
- Pick the SDK-documented field names; treat the heuristic fallbacks as last-resort logged warnings.

### 3.7 🟢 Centralized scheduler
- Single timer driving `metricsRefresh`, `bagsRefresh`, `cleanup`, `feedCacheRefresh` with offsets to prevent collisions.

### 3.8 🟢 Remove `refreshBagsApiKeyFromEnvFile()` workaround
- File: `server/loadEnv.ts:55-60`.
- Diagnose root cause of dotenv load order; remove disk re-read from hot paths.

### 3.9 🟢 Drop dead `launches` insert fallback
- File: `server/index.ts:797-826`. The branch is unreachable in a healthy schema and corrupts records on transient errors.

### 3.10 🟢 Clean up committed scratch artifacts
- Add to `.gitignore`: `Untitled`, `scratch/`, `dist/`, any local-only docs.

---

## Tracking

When starting an item, create a branch `fix/<phase>.<item>-<slug>` (e.g. `fix/0.2-admin-auth`). Tick the item here in the same PR.
