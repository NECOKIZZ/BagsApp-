# Market Terminal + Narrative Pipeline Implementation Plan

**Date:** 2026-05-06
**Status:** Planning

---

## Overview

This plan addresses the user's requirements for:
1. Making all tokens clickable to their detail pages
2. Ensuring every token has a score using the existing scoring model
3. Token details available immediately when pulled from Jupiter/Bags
4. Improved AI prompt for token discovery (tickers + nouns)
5. Market terminal dynamic filtering by selected tweet's narrative
6. Simplified market terminal params (token, score, created_at, 24h change, buy button)
7. Confirm buy button on token details page

---

## Phase 1: Market Terminal Clickability & Simplification

### 1.1 Make terminal tokens clickable to `/token/:mint`

**File:** `src/app/components/MarketTerminal.tsx`

**Changes:**
- Add `useNavigate` hook
- Wrap token row in `<button>` or add onClick handler
- Navigate to `/token/${token.mint}` on click
- Keep existing Jupiter buy button as secondary action

**Before:**
```tsx
activeTokens.map((token: any) => (
  <div key={token.mint} className="group flex items-center ...">
    <div>{token.name}</div>
    ...
  </div>
))
```

**After:**
```tsx
const navigate = useNavigate();

activeTokens.map((token: any) => (
  <button
    key={token.mint}
    onClick={() => navigate(`/token/${token.mint}`)}
    className="group flex items-center w-full text-left ..."
  >
    <div>{token.name}</div>
    ...
  </button>
))
```

---

### 1.2 Simplify terminal params to: token, score, created_at, 24h change, buy button

**File:** `src/app/components/MarketTerminal.tsx`

**Current params:** name, score, time, mcap (OLD), returns (YOUNG), buy button

**New params:**
- Token name/ticker
- Score (with color coding)
- Created at (onchain timestamp, formatted as relative time)
- 24h change (percentage, green/red)
- Buy button (Jupiter swap)

**Changes:**
- Update table header to show new columns
- Remove `mcap` column from OLD tab
- Remove `returns` column from YOUNG tab (replace with 24h change for all)
- Ensure `created_at` is fetched from onchain data (Bags pool `created_at` or token mint time)
- Format 24h change consistently across all tabs

**Data shape needed:**
```tsx
type TerminalToken = {
  mint: string;
  name: string;
  ticker?: string;
  score: number;
  createdAt: string; // ISO timestamp from onchain
  change24h: number; // percentage, can be null
};
```

---

### 1.3 Filter terminal by selected tweet's narrative

**Current state:** `narrative` prop exists but is not used to filter tokens.

**File:** `src/app/components/MarketTerminal.tsx`

**Changes:**
- When `narrative` prop is provided, filter tokens to only those matching that narrative
- When `narrative` is null, show all tokens (current behavior)
- Add visual indicator when filtering is active ("Filtered by: {narrative}")

**Implementation:**
```tsx
const filteredTokens = useMemo(() => {
  if (!narrative) return activeTokens;
  return activeTokens.filter(t => t.narrative === narrative);
}, [activeTokens, narrative]);
```

**Server-side change needed:** `TerminalToken` type needs `narrative` field from `narrative_tokens` table.

---

## Phase 2: Token Scoring Everywhere

### 2.1 Apply scoring model to Bags feed tokens

**File:** `server/narrativePipeline.ts`

**Current state:** Tokens from Bags feed get a score from the AI weight + Bags quality, but not the full Scratch Score model.

**Changes:**
- After fetching Bags pool data, call `calculateScratchScore` for each pool
- Store the calculated score in `narrative_tokens.score` column
- This ensures all tokens (Bags, Jupiter, launched-here) have consistent scoring

**Integration point:** In `searchAndScoreTokens`, after `bagsMatches.set(...)`:

```ts
import { calculateScratchScore } from "./scoring";

// After fetching Bags pool data
const tokenData: TokenData = {
  mcap: pool.marketCapUsd ?? 0,
  volume24h: pool.volume24hUsd ?? 0,
  liquidity: pool.liquidityUsd ?? 0,
  holders: pool.holders ?? 0,
  lifecycle: pool.lifecycle ?? 'PRE_LAUNCH',
  twitter: pool.twitter,
  telegram: pool.telegram,
  website: pool.website,
  buyerRank: pool.buyerRank,
  returns: pool.returns24h,
  top1HolderPct: pool.top1HolderPct,
  top5HolderPct: pool.top5HolderPct,
};

const scratchScore = calculateScratchScore(tokenData);
```

---

### 2.2 Apply scoring to Jupiter fallback tokens

**File:** `server/narrativePipeline.ts`

**Current state:** Jupiter-only tokens get a simplified score based on AI weight + quality.

**Changes:**
- For Jupiter tokens, we have limited data (name, symbol, verified status)
- Apply a simplified scoring variant that rewards verified tokens and penalizes unknowns
- Store in `narrative_tokens.score`

**Simplified Jupiter scoring:**
```ts
function calculateJupiterScore(token: JupiterToken): number {
  let score = 50; // baseline
  if (token.verified) score += 20;
  if (token.volume24hUsd > 1000) score += 10;
  if (token.marketCapUsd > 10000) score += 10;
  return Math.min(100, score);
}
```

---

### 2.3 Ensure terminal data includes scores

**File:** `server/index.ts` (endpoint for terminal data)

**Current state:** Terminal endpoint likely needs to be created or updated to return scored tokens.

**Changes:**
- Create/Update `GET /api/feed?view=terminal` to return tokens with scores
- Query `narrative_tokens` to get stored scores
- Join with Bags pool data for live metrics
- Return shape matching new `TerminalToken` type

**SQL query:**
```ts
const { data: tokens } = await supabase
  .from("narrative_tokens")
  .select("token_mint, token_name, token_ticker, score, created_at, is_on_bags, narrative")
  .order("updated_at", { ascending: false })
  .limit(100);
```

---

## Phase 3: AI Prompt Upgrade (Tickers + Nouns)

### 3.1 Replace narrative extraction prompt

**File:** `server/narrativePipeline.ts`

**Current prompt:** Returns narrative summary + search terms (term, weight, reason).

**New prompt structure:**
```ts
const SYSTEM_PROMPT =
  "You extract Solana memecoin ticker candidates and noun keywords from tweets. " +
  "In memecoin culture ANY word can be a token — verbs, slang, single letters, names, vibes.";

const USER_PROMPT = (content: string, creatorHandle: string): string =>
  `Tweet: "${content}"
Creator: @${creatorHandle}

Your job:
1. Generate the TOP 5 most probable Solana memecoin tickers that either already exist or could be created based on this tweet.
   - Think like a degen: exact phrases, acronyms, creator name + keywords, single strong nouns, numbers/symbols
   - Rank by how likely a memecoin community would actually use them
   - Return ONLY the tickers (1-5 words each, uppercase preferred), ranked

2. Separately identify ALL nouns in the tweet. Nouns are highest priority for memecoin naming.
   - List them separately from tickers
   - A noun that is also a ticker candidate should appear in BOTH lists
   - Include compound nouns (e.g. "AI agent")

Return JSON only (no markdown fences):
{
  "narrative": "1-sentence summary of what the tweet is about (literal, not crypto-coded)",
  "tickers": [
    { "ticker": "GOING", "weight": 95, "reason": "main verb, strong vibe word" },
    { "ticker": "TREND", "weight": 85, "reason": "noun subject, degen staple" },
    { "ticker": "GROK", "weight": 70, "reason": "named entity, memecoin pattern" }
  ],
  "nouns": [
    { "noun": "trend", "weight": 100, "reason": "primary noun subject" },
    { "noun": "agent", "weight": 90, "reason": "AI agent narrative" }
  ]
}`;
```

---

### 3.2 Update type definitions

**File:** `server/narrativePipeline.ts`

**New type:**
```ts
type NarrativeExtraction = {
  narrative: string;
  tickers: Array<{ ticker: string; weight: number; reason?: string }>;
  nouns: Array<{ noun: string; weight: number; reason?: string }>;
};
```

---

### 3.3 Update search logic to use tickers + nouns

**File:** `server/narrativePipeline.ts` (searchAndScoreTokens function)

**Changes:**
- Use `tickers` array for primary search (higher weight)
- Use `nouns` array as secondary search (medium-high weight)
- Dedupe between tickers and nouns (if a noun is also a ticker, use the higher weight)
- Limit to top 5-7 combined search terms per tweet to control API quota

**Search strategy:**
```ts
const searchTerms = [
  ...result.tickers.map(t => ({ term: t.ticker, weight: t.weight, reason: t.reason })),
  ...result.nouns.map(n => ({ term: n.noun, weight: n.weight * 0.8, reason: n.reason }))
].sort((a, b) => b.weight - a.weight).slice(0, 7);
```

---

## Phase 4: Token Details Page Confirmation

### 4.1 Verify buy button exists and is prominent

**File:** `src/app/pages/TokenDetailPage.tsx`

**Current state:** Buy button exists in action section (lines 326-344).

**Verification:**
- Buy button is prominent (green, bold, uppercase)
- Links to `https://jup.ag/swap/SOL-${mint}`
- Sell button also available
- "View on Bags" button if `isOnBags` is true

**Status:** ✅ Already implemented. No changes needed.

---

## Phase 5: Server Endpoint Updates

### 5.1 Update `/api/feed?view=terminal` endpoint

**File:** `server/index.ts`

**Changes:**
- Query `narrative_tokens` for scored tokens
- Join with Bags pool data for live metrics (24h change, created_at)
- Filter by narrative if query param provided
- Return shape matching new `TerminalToken` type

**New endpoint logic:**
```ts
app.get("/api/feed", async (req, res) => {
  const view = req.query.view;
  const narrativeFilter = req.query.narrative;

  if (view === "terminal") {
    let query = supabase
      .from("narrative_tokens")
      .select("token_mint, token_name, token_ticker, score, created_at, is_on_bags, narrative");

    if (narrativeFilter) {
      query = query.eq("narrative", narrativeFilter);
    }

    const { data: tokens } = await query.order("updated_at", { ascending: false }).limit(100);

    // Enrich with Bags pool data for 24h change
    const enriched = await Promise.all(
      tokens.map(async (t) => {
        const pool = await bagsGetPoolByMint(t.token_mint);
        return {
          mint: t.token_mint,
          name: t.token_name ?? t.token_ticker ?? t.token_mint.slice(0, 8),
          ticker: t.token_ticker,
          score: t.score ?? 0,
          createdAt: t.created_at,
          change24h: pool?.change24h ?? 0,
          narrative: t.narrative,
        };
      })
    );

    // Group into young/old/myApp based on created_at
    const young = enriched.filter(t => isYoung(t.createdAt));
    const old = enriched.filter(t => !isYoung(t.createdAt));
    // myApp would need wallet connection context

    res.json({ young, old, myApp: [] });
    return;
  }
  // ... existing feed logic
});
```

---

### 5.2 Ensure narrative is stored and queryable

**File:** `server/narrativePipeline.ts`

**Current state:** Narrative is stored in `tweets.narrative`, not `narrative_tokens`.

**Changes:**
- When upserting to `narrative_tokens`, include `narrative` field from the tweet
- This enables terminal filtering by narrative

**Upsert change:**
```ts
await supabase.from("narrative_tokens").upsert({
  tweet_id,
  token_mint: mint,
  token_name: name,
  token_ticker: symbol,
  score: finalScore,
  is_on_bags: true,
  narrative: narrative, // Add this
  // ... other fields
});
```

---

## Data Flow Summary

### Current flow:
1. Tweet received → AI extracts narrative + search terms
2. Search terms → Bags/Jupiter lookup → tokens stored in `narrative_tokens`
3. Feed queries `tweets` + `narrative_tokens` → displays tokens per tweet
4. Terminal queries static endpoint → displays all tokens (no filtering)

### New flow:
1. Tweet received → AI extracts narrative + tickers + nouns
2. Tickers/nouns → Bags/Jupiter lookup → tokens scored + stored with narrative
3. Feed queries `tweets` + `narrative_tokens` → displays tokens per tweet
4. Terminal queries `narrative_tokens` with narrative filter → displays filtered tokens
5. Click token → navigate to `/token/:mint` → fetch enriched metrics → display details

---

## Implementation Order

1. **Phase 1.1:** Make terminal tokens clickable (quick win, client-only)
2. **Phase 1.2:** Simplify terminal params (requires server endpoint update)
3. **Phase 2.1:** Apply scoring to Bags tokens (server-side)
4. **Phase 2.2:** Apply scoring to Jupiter tokens (server-side)
5. **Phase 3:** AI prompt upgrade (server-side, highest impact)
6. **Phase 1.3:** Narrative filtering (requires Phase 3 + Phase 5.2)
7. **Phase 5:** Server endpoint updates (enables Phase 1.2 + 1.3)
8. **Phase 4:** Verify buy button (already done, confirmation only)

---

## Testing Checklist

- [ ] Terminal token rows are clickable and navigate to `/token/:mint`
- [ ] Terminal shows: token name, score, created_at, 24h change, buy button
- [ ] Terminal filters by narrative when tweet is selected
- [ ] All tokens have a score (Bags, Jupiter, terminal)
- [ ] AI returns tickers + nouns in expected JSON format
- [ ] Search uses tickers with higher weight than nouns
- [ ] Token details page has prominent buy button
- [ ] 24h change displays correctly (green for positive, red for negative)
- [ ] Created_at shows relative time (e.g. "2h ago")
- [ ] Narrative filtering indicator shows when active

---

## Open Questions

1. **"myApp" tab in terminal:** This should show tokens the connected wallet holds. Requires wallet state to be passed to terminal or a separate endpoint. Implement after Phase 2 (Tokens Held page).

2. **24h change source:** Bags pool data includes this, but Jupiter tokens may not. Fallback to `null` or calculate from historical data if available.

3. **Created_at source:** Bags pools have `created_at`. For Jupiter tokens, use token mint timestamp or `null`.

4. **AI prompt refinement:** The proposed prompt is a starting point. May need iteration based on actual AI output quality.

---

## Dependencies

- Requires `calculateScratchScore` from `server/scoring.ts` (already exists)
- Requires Bags pool data to include `created_at` and `change24h` (verify availability)
- Requires `narrative_tokens` table to have `narrative` column (may need migration)
