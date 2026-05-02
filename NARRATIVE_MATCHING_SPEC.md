# BagsApp — Semantic Narrative Matching Engine
## Implementation & Flow Specification

> **For the Builder**  
> This document covers the two new systems: (1) Claude-powered tweet entity extraction and (2) semantic token scoring with time decay. Read top-to-bottom before touching any files.

---

## 1. What We're Replacing & Why

### Current state
The existing NLP runs compromise keyword matching — likely basic tokenisation or simple string inclusion checks. It fails on the core use case because:

- `"Jerome Powell just spoke"` → does **not** match `$POWELL`, `$FED`, `$RATES`
- `"Elon posted the doge meme again"` → does **not** match `$DOGE`, `$ELON`, `$MUSK`
- `"whitehouse statement on crypto"` → does **not** match `$TRUMP`, `$USA`, `$POTUS`, `$WHITE`

The semantic gap between tweet language and token tickers/names is exactly where the alpha lives. Degen token names are deliberately punny, abbreviated, or culturally referential — no regex will bridge that gap.

### What we're building
A **two-stage AI pipeline** that runs on every ingested tweet:

- **Stage 1 — Entity & Concept Extraction**: Claude reads the tweet and returns structured JSON: entities, keywords, aliases, themes, and sentiment.
- **Stage 2 — Token Relevance Scoring**: Those extracted concepts are matched against candidate tokens (from Bags or existing `narrative_tokens`) using a weighted fuzzy-match formula that populates `match_score`.

Plus a **time decay multiplier** applied at ranking time (not at storage time) so the `match_score` column stays clean and reusable.

---

## 2. Full Pipeline — End-to-End Flow

```
[twitterapi.io webhook POST]
         │
         ▼
┌─────────────────────────────┐
│  server/index.ts            │
│  POST /api/webhooks/        │
│  twitterapi                 │
│  • parse tweet payload      │
│  • upsert into tweets table │
└────────────┬────────────────┘
             │  tweet.content + tweet.id
             ▼
┌─────────────────────────────┐
│  server/narrativePipeline.ts│  ← NEW FILE
│  STAGE 1: Claude Extraction │
│  • call Anthropic API       │
│  • structured JSON prompt   │
│  • returns: entities,       │
│    keywords, aliases,       │
│    themes, sentiment        │
└────────────┬────────────────┘
             │  ExtractionResult
             ▼
┌─────────────────────────────┐
│  server/narrativePipeline.ts│
│  STAGE 2: Token Scoring     │
│  • fetch candidate tokens   │
│    from Bags search API     │
│  • score each token against │
│    ExtractionResult         │
│  • apply weighted formula   │
│  • returns: ScoredToken[]   │
└────────────┬────────────────┘
             │  ScoredToken[] (match_score 0-100)
             ▼
┌─────────────────────────────┐
│  Supabase                   │
│  upsert narrative_tokens    │
│  (tweet_id, token_mint,     │
│   match_score, ...)         │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  GET /api/feed              │
│  RANKING LAYER (in-memory)  │
│  final_score =              │
│    match_score              │
│    × time_decay(launched_at)│
│    × creator_score_weight   │
│  → sorted DESC              │
└─────────────────────────────┘
             │
             ▼
       React FeedPage
    (tokens ranked by
     semantic relevance
     + recency)
```

---

## 3. Stage 1 — Claude Entity Extraction

### File: `server/narrativePipeline.ts`

#### The Extraction Prompt

The prompt must instruct Claude to return **only valid JSON**, no preamble, no markdown fences. This is critical for safe parsing.

```typescript
const EXTRACTION_SYSTEM_PROMPT = `
You are a crypto narrative analyst. Given a tweet, extract structured data to help match it to relevant Solana meme tokens.

Return ONLY a valid JSON object. No preamble, no markdown, no explanation.

Schema:
{
  "entities": string[],        // Named people, orgs, places, projects (e.g. ["Elon Musk", "Federal Reserve", "White House"])
  "keywords": string[],        // Core topics as single words (e.g. ["rates", "inflation", "doge", "meme"])
  "ticker_aliases": string[],  // Likely token tickers this tweet could spawn (e.g. ["ELON", "MUSK", "DOG", "DOGE"])
  "themes": string[],          // Broader narrative themes (e.g. ["political", "memecoin", "macro", "AI", "animal"])
  "sentiment": "bullish" | "bearish" | "neutral" | "hype",
  "narrative_strength": number // 0-100: how likely is this tweet to drive a token narrative?
}
`;

const EXTRACTION_USER_TEMPLATE = (tweetContent: string) =>
  `Tweet: "${tweetContent}"`;
```

#### The API Call

```typescript
// server/narrativePipeline.ts

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractionResult {
  entities: string[];
  keywords: string[];
  ticker_aliases: string[];
  themes: string[];
  sentiment: "bullish" | "bearish" | "neutral" | "hype";
  narrative_strength: number;
}

export async function extractNarrativeConcepts(
  tweetContent: string
): Promise<ExtractionResult | null> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: EXTRACTION_USER_TEMPLATE(tweetContent) },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    // Strip any accidental markdown fences before parsing
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as ExtractionResult;
  } catch (err) {
    console.error("[NarrativePipeline] Claude extraction failed:", err);
    return null; // Fail gracefully — don't block tweet ingestion
  }
}
```

#### What Claude Returns (Example)

Input tweet: `"Jerome Powell just spoke. Rates staying high. The fed isn't cutting anytime soon 🚨"`

```json
{
  "entities": ["Jerome Powell", "Federal Reserve"],
  "keywords": ["rates", "interest", "fed", "cut", "hawkish"],
  "ticker_aliases": ["POWELL", "FED", "JEROME", "RATES", "HAWK"],
  "themes": ["macro", "monetary policy", "bearish"],
  "sentiment": "bearish",
  "narrative_strength": 72
}
```

Input tweet: `"The whitehouse just posted about crypto regulation. This is huge 🏛️"`

```json
{
  "entities": ["White House", "US Government"],
  "keywords": ["regulation", "crypto", "policy", "government"],
  "ticker_aliases": ["WHITE", "HOUSE", "POTUS", "USA", "TRUMP", "GOV"],
  "themes": ["political", "regulation", "macro"],
  "sentiment": "hype",
  "narrative_strength": 88
}
```

---

## 4. Stage 2 — Token Relevance Scoring

### Candidate Token Sources

Candidates come from two places:

1. **Bags search API** — query by each keyword/alias to find existing tokens on-chain
2. **Existing `narrative_tokens` rows** — tokens already in your DB that may already be linked to this tweet or similar ones

For each candidate token you have: `token_name`, `token_ticker`, and optionally a `description`.

### Scoring Formula

Each candidate token gets a `match_score` from 0–100. The formula checks three fields with different weights:

```
match_score = (
  ticker_score  × 0.50   +   // Ticker match is the strongest signal
  name_score    × 0.35   +   // Token name match is second
  theme_score   × 0.15       // Theme/description match is weakest
)
× 100
```

Each sub-score is 0.0–1.0, calculated as:

```typescript
// Returns 0.0-1.0
function tickerScore(ticker: string, extraction: ExtractionResult): number {
  const t = ticker.toUpperCase();
  // Exact match on a predicted alias = full score
  if (extraction.ticker_aliases.includes(t)) return 1.0;
  // Partial match (alias is substring of ticker or vice versa) = partial
  const partialMatch = extraction.ticker_aliases.some(
    (a) => t.includes(a) || a.includes(t)
  );
  if (partialMatch) return 0.6;
  // Keyword overlap
  const kwMatch = extraction.keywords.some(
    (k) => t.includes(k.toUpperCase()) || k.toUpperCase().includes(t)
  );
  if (kwMatch) return 0.4;
  return 0.0;
}

function nameScore(tokenName: string, extraction: ExtractionResult): number {
  const name = tokenName.toLowerCase();
  // Check against entities (people, orgs, places)
  const entityMatch = extraction.entities.some((e) =>
    name.includes(e.toLowerCase().split(" ")[0]) // match on first name / org shortname
  );
  if (entityMatch) return 1.0;
  // Check against keywords
  const kwMatch = extraction.keywords.filter((k) =>
    name.includes(k.toLowerCase())
  ).length;
  return Math.min(kwMatch * 0.3, 1.0);
}

function themeScore(tokenName: string, themes: string[]): number {
  // Basic theme-to-name heuristics
  // e.g. theme "animal" → check if name contains common animal words
  const themeKeywordMap: Record<string, string[]> = {
    animal: ["dog", "cat", "pepe", "frog", "ape", "bear", "bull", "bird"],
    political: ["trump", "biden", "usa", "america", "potus", "gov", "house"],
    ai: ["ai", "gpt", "llm", "robot", "agent", "brain"],
    macro: ["fed", "rate", "bond", "gold", "dollar", "inflation"],
    // extend as needed
  };
  const name = tokenName.toLowerCase();
  let maxScore = 0;
  for (const theme of themes) {
    const themeWords = themeKeywordMap[theme.toLowerCase()] ?? [];
    if (themeWords.some((w) => name.includes(w))) {
      maxScore = Math.max(maxScore, 1.0);
    }
  }
  return maxScore;
}

export function scoreToken(
  token: { token_name: string; token_ticker: string },
  extraction: ExtractionResult
): number {
  const ts = tickerScore(token.token_ticker, extraction);
  const ns = nameScore(token.token_name, extraction);
  const th = themeScore(token.token_name, extraction.themes);
  const raw = ts * 0.5 + ns * 0.35 + th * 0.15;
  return Math.round(raw * 100); // 0-100 integer → stored in match_score
}
```

---

## 5. Time Decay — Ranking Multiplier

Time decay is applied **at query time** in the `/api/feed` handler, **not stored** in the DB. This keeps `match_score` clean as a pure semantic signal.

### Window & Decay Curve

- **Hard cutoff**: 7 days (1 week) — tokens launched more than 7 days after the tweet are excluded
- **Decay function**: Exponential decay over the window

```typescript
// Returns multiplier 0.0-1.0
// hoursElapsed = hours between tweet posted_at and token launched_at
export function timeDecayMultiplier(hoursElapsed: number): number {
  const MAX_HOURS = 168; // 7 days
  if (hoursElapsed < 0 || hoursElapsed > MAX_HOURS) return 0;

  // Exponential decay: full score at 0h, ~0.05 at 168h
  // Adjust the decay constant (0.018) to tune how aggressive the falloff is
  return Math.exp(-0.018 * hoursElapsed);
}

// Usage in /api/feed ranking:
const hoursElapsed =
  (Date.now() - new Date(token.launched_at).getTime()) / (1000 * 60 * 60);

const finalScore =
  token.match_score * timeDecayMultiplier(hoursElapsed) * creatorScoreWeight(tweet.creator_score);
```

### Decay Table (reference)

| Hours after tweet | Multiplier |
|---|---|
| 0h (immediate) | 1.00 |
| 6h | 0.90 |
| 24h (1 day) | 0.65 |
| 72h (3 days) | 0.27 |
| 120h (5 days) | 0.11 |
| 168h (7 days) | 0.05 → excluded |

This means a token with `match_score: 80` launched 3 days later ranks the same as a token with `match_score: 22` launched immediately. Recency matters, but quality can compensate.

---

## 6. Integration Points — Where to Wire This In

### 6a. Webhook Handler (primary trigger)

In `server/index.ts`, after upserting the tweet into Supabase:

```typescript
// After: await supabase.from('tweets').upsert(...)

// Fire-and-forget (don't await — don't slow down webhook response)
runNarrativePipeline(tweet).catch((err) =>
  console.error("[Pipeline] failed for tweet", tweet.tweet_id, err)
);
```

`runNarrativePipeline` lives in `server/narrativePipeline.ts` and does:
1. `extractNarrativeConcepts(tweet.content)` → `ExtractionResult`
2. Fetch candidate tokens from Bags using extraction keywords
3. `scoreToken(candidate, extraction)` for each candidate
4. Upsert top N (suggest: top 5) into `narrative_tokens` with `match_score`

### 6b. Feed Handler (ranking)

In `server/index.ts`, the `GET /api/feed` handler already joins tweets with `narrative_tokens`. Add a post-processing sort step:

```typescript
// After fetching rows from Supabase:
const ranked = rows.map((tweet) => ({
  ...tweet,
  narrative_tokens: tweet.narrative_tokens
    .map((token) => {
      const hoursElapsed =
        (Date.now() - new Date(token.launched_at ?? tweet.posted_at).getTime()) /
        3_600_000;
      return {
        ...token,
        final_score: Math.round(
          token.match_score * timeDecayMultiplier(hoursElapsed)
        ),
      };
    })
    .filter((t) => t.final_score > 0) // exclude tokens past 7-day window
    .sort((a, b) => b.final_score - a.final_score),
}));
```

### 6c. New Environment Variable

Add to `.env` and `.env.example`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 6d. New Dependency

```bash
npm install @anthropic-ai/sdk
```

---

## 7. New File: `server/narrativePipeline.ts` — Full Skeleton

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabaseClient";
// import { searchBagsTokens } from "./bagsClient"; // wire to existing Bags client

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Types ---

export interface ExtractionResult {
  entities: string[];
  keywords: string[];
  ticker_aliases: string[];
  themes: string[];
  sentiment: "bullish" | "bearish" | "neutral" | "hype";
  narrative_strength: number;
}

export interface ScoredToken {
  token_name: string;
  token_ticker: string;
  token_mint?: string;
  match_score: number;
}

// --- Stage 1: Claude Extraction ---

const SYSTEM_PROMPT = `...`; // (see Section 3 above)

export async function extractNarrativeConcepts(
  content: string
): Promise<ExtractionResult | null> {
  // (see Section 3 above)
}

// --- Stage 2: Token Scoring ---

export function scoreToken(
  token: { token_name: string; token_ticker: string },
  extraction: ExtractionResult
): number {
  // (see Section 4 above)
}

// --- Time Decay ---

export function timeDecayMultiplier(hoursElapsed: number): number {
  // (see Section 5 above)
}

// --- Orchestrator ---

export async function runNarrativePipeline(tweet: {
  tweet_id: string;
  content: string;
}): Promise<void> {
  const extraction = await extractNarrativeConcepts(tweet.content);
  if (!extraction) return;

  // Skip low-signal tweets (optional threshold)
  if (extraction.narrative_strength < 30) return;

  // Fetch candidates from Bags using top aliases + keywords
  const searchTerms = [
    ...extraction.ticker_aliases.slice(0, 3),
    ...extraction.keywords.slice(0, 3),
  ];

  const candidates: ScoredToken[] = [];

  for (const term of searchTerms) {
    // TODO: wire to bagsClient search endpoint
    // const results = await searchBagsTokens(term);
    // candidates.push(...results);
  }

  // Deduplicate by ticker
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.token_ticker)) return false;
    seen.add(c.token_ticker);
    return true;
  });

  // Score all candidates
  const scored = unique
    .map((c) => ({ ...c, match_score: scoreToken(c, extraction) }))
    .filter((c) => c.match_score > 10) // noise floor
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 5); // top 5 only

  // Upsert into narrative_tokens
  for (const token of scored) {
    await supabase.from("narrative_tokens").upsert(
      {
        tweet_id: tweet.tweet_id,
        token_name: token.token_name,
        token_ticker: token.token_ticker,
        token_mint: token.token_mint ?? null,
        match_score: token.match_score,
        launched_at: new Date().toISOString(),
      },
      { onConflict: "tweet_id,token_ticker" }
    );
  }
}
```

---

## 8. Database — No Schema Changes Required

The existing `narrative_tokens` schema already has `match_score integer (0-100)`. That column is all we need. The `score` column (overall token score) can remain as a separate composite score if you want to blend other signals later.

The only implicit requirement: `narrative_tokens` needs a unique constraint on `(tweet_id, token_ticker)` for the upsert to work correctly. If it doesn't exist, add it:

```sql
ALTER TABLE narrative_tokens
  ADD CONSTRAINT narrative_tokens_tweet_ticker_unique
  UNIQUE (tweet_id, token_ticker);
```

---

## 9. Cost Estimate — Anthropic API

Claude Sonnet 4 pricing (as of May 2026):
- Input: ~$3 / 1M tokens
- Output: ~$15 / 1M tokens

Each tweet extraction uses approximately:
- ~200 tokens input (system prompt + tweet)
- ~150 tokens output (JSON result)

At 500 tweets/day:
- Input: 500 × 200 = 100K tokens = **$0.30/day**
- Output: 500 × 150 = 75K tokens = **$1.13/day**
- **Total: ~$1.43/day → ~$43/month**

At 100 tweets/day: **~$9/month**

Add `ANTHROPIC_API_KEY` to the env var table in the main PROJECT_DOCS and to `.env.example`.

---

## 10. Implementation Checklist

**Backend**
- [ ] `npm install @anthropic-ai/sdk`
- [ ] Add `ANTHROPIC_API_KEY` to `.env`, `.env.example`, Railway vars
- [ ] Create `server/narrativePipeline.ts` using skeletons above
- [ ] Wire `runNarrativePipeline(tweet)` into webhook handler (fire-and-forget)
- [ ] Wire `timeDecayMultiplier` into `/api/feed` response sorting
- [ ] Add unique constraint `(tweet_id, token_ticker)` to `narrative_tokens` in Supabase
- [ ] Wire Bags token search into the pipeline's candidate fetch step (check `bagsClient.ts` for existing search method or add one)

**Testing**
- [ ] Write a test tweet fixture for a political narrative (e.g. whitehouse) and log extracted JSON
- [ ] Write a test tweet fixture for a personality narrative (e.g. Elon) and verify ticker_aliases match expected tokens
- [ ] Verify `match_score` values are non-zero for known token/tweet pairs
- [ ] Verify `final_score` in feed response drops correctly for older tokens

**Frontend** (no changes required for v1)
- The existing `TweetCard.tsx` already renders `match_score` — it will automatically reflect the new AI-generated scores once the backend is live.

---

*This spec covers the full semantic matching system. For questions on Bags API search endpoints or existing `bagsClient.ts` methods, cross-reference the main PROJECT_DOCS.*
