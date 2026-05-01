# Scratch Score — Token Scoring System

> **Document version:** 1.0  
> **Last updated:** 2026-05-01  
> **Applies to:** `narrative_tokens.score` column in Supabase  
> **Score range:** 0–100  

---

## 1. Purpose

The Scratch Score quantifies how likely a token is to be an early runner worth buying, from a degen's perspective. It is not a price prediction — it is a signal quality index that rewards genuine on-chain activity and punishes manipulation, wash trading, and rug setups.

Every score component is ratio-based or log-scaled so that brand-new sub-$5k mcap tokens (the dominant token type on this platform) compete fairly against larger, older tokens. The scoring system deliberately does **not** penalise small raw numbers; it penalises bad *ratios* and missing *signals*.

---

## 2. Data Sources

| Source | Method | Fields used |
|--------|--------|-------------|
| Bags API | `/solana/bags/pools/token-mint` | `mcap`, `volume24h`, `liquidity`, `holders`, `lifecycle` |
| Bags API | Token metadata | `twitter`, `telegram`, `website` |
| Solana RPC (Helius) | `getTokenLargestAccounts` | Top 20 holder accounts + amounts |
| Solana RPC (Helius) | `getTokenSupply` | Total circulating supply |

The concentration check (Section 7) requires two additional RPC calls beyond what Bags provides. These should run once at mint discovery and be cached in a new `narrative_tokens` column (`concentration_flag`). Re-run on significant holder count changes.

---

## 3. Score Components Overview

| # | Component | Max pts | Source | Notes |
|---|-----------|---------|--------|-------|
| 1 | Vol / MCap ratio | 30 | Bags | Primary runner signal |
| 2 | Holder distribution quality | 15 | Bags + RPC | Normalised to mcap tier |
| 3 | Vol / Liquidity ratio | 10 | Bags | Pool health signal |
| 4 | MCap tier fit | 10 | Bags | Rewards early-stage tokens |
| 5 | Lifecycle status | 10 | Bags | Graduation = confirmed pool |
| 6 | Liquidity depth | 10 | Bags | Absolute TVL, log-scaled |
| 7 | Socials completeness | 5 | Bags metadata | Presence check, not quality |
| 8 | Buyer rank + returns | 5 | Bags | Soft momentum signal |
| **Total** | | **95** | | Before penalties |
| P1 | Rug combo penalty | −5 | Bags + RPC | All three flags must fire |
| P2 | Concentration penalty | −10 | Solana RPC | Whale / bundle flag |

**Maximum possible score: 95 + 0 = 95 (penalties only subtract, never below 0)**  
*Note: Max is 95 not 100 to leave headroom. A 95 is a near-perfect token. 70+ at sub-$10k mcap is a strong early runner.*

---

## 4. Component Formulas

### 4.1 Vol / MCap Ratio — 30 points

The most important signal. Measures daily trading velocity relative to the token's size. Hard to sustain artificially without losing real money.

```
ratio     = volume24h / mcap
score     = min(ratio / 2.0, 1.0) × 30
```

| Ratio | Interpretation | Score |
|-------|---------------|-------|
| < 0.05 (5%) | Dead. No one is trading. | 0–1 |
| 0.10–0.30 | Quiet. Existing holders, no new entrants. | 3–9 |
| 0.50–1.0 | Active. Worth watching. | 15–30 |
| 1.0–2.0+ | Hot. Daily vol equals or exceeds mcap. | 30 (cap) |

Cap ratio at 2.0 (200%). Above that it starts to suggest wash trading rather than organic activity, and the vol/liq ratio (4.3) handles that case.

---

### 4.2 Holder Distribution Quality — 15 points

**Key revision from naive holder count:** raw holder count is meaningless without mcap context. A $2M token with 300 holders is more suspicious than a $3k token with 8 holders — the large token should have thousands of holders at that size. This component measures *distribution quality relative to stage*, not absolute count.

#### Step 1 — Determine expected holder range for mcap tier

| MCap tier | Expected holder range | Distribution floor |
|-----------|----------------------|-------------------|
| < $10k | 5–50 | Early adopters only, normal |
| $10k–$100k | 20–300 | Growing community expected |
| $100k–$500k | 100–1,000 | Should be broadly distributed |
| > $500k | 500+ | Sparse distribution is suspicious |

#### Step 2 — Score using tier-adjusted log scale

```
tierCap   = expectedHolderRangeMax  (from table above)
score     = min(log10(max(holders, 1)) / log10(tierCap), 1.0) × 15
```

This means:
- A $3k token with 8 holders scores `log10(8) / log10(50) × 15 = 10.7pts` — rewarded for early distribution
- A $2M token with 300 holders scores `log10(300) / log10(500) × 15 = 12.7pts` — slightly penalised for sparse distribution at its size
- A $180k token with 340 holders scores `log10(340) / log10(1000) × 15 = 13.9pts` — strong

#### Step 3 — Apply concentration adjustment (if RPC data available)

If `concentration_flag` is set (see Section 7), multiply holder score by 0.5. A token where one wallet holds the majority of supply does not have real holders — it has one actor across many accounts.

---

### 4.3 Vol / Liquidity Ratio — 10 points

Measures pool health. High volume through thin liquidity = easily pumped and dumped. High volume through deep liquidity = organic.

```
ratio     = volume24h / liquidity
score     = min(ratio / 5.0, 1.0) × 10
```

| Ratio | Interpretation | Score |
|-------|---------------|-------|
| < 0.5 | Dead pool. Liquidity just sitting there. | 1 |
| 1.0–2.0 | Healthy. Good two-sided trading. | 2–4 |
| 3.0–5.0 | Very active relative to pool size. | 6–10 |
| > 5.0 | Capped. Could be thin pool pumping. | 10 (cap) |

---

### 4.4 MCap Tier Fit — 10 points

Rewards the sweet spot that degens actually target: tokens with room to 10x–100x. Does not penalise sub-$5k tokens — that is the primary use case of this platform.

```
if mcap < 1,000:         score = 4   // Pre-traction, almost no data
if mcap < 5,000:         score = 8   // Core launch zone — healthy score
if mcap < 50,000:        score = 9   // Early runner zone
if mcap < 500,000:       score = 10  // Prime degen territory
if mcap < 2,000,000:     score = 7   // Extended run, still tradeable
if mcap >= 2,000,000:    score = 3   // Heavy bag risk, most upside gone
```

Note: sub-$1k mcap scores 4 not 0. There may be zero volume data yet, but the token exists and is in the queue — do not zero it out.

---

### 4.5 Lifecycle Status — 10 points

Bags reports the token's current state. Graduation from `PRE_GRAD` to `MIGRATED` is a genuine on-chain event, not gameable.

```
PRE_LAUNCH:   0 pts  // No pool data yet. Score is effectively 0 overall.
PRE_GRAD:     7 pts  // Active bonding curve. Risky, high upside.
MIGRATING:    8 pts  // Transition state. Positive signal.
MIGRATED:    10 pts  // Graduated. Pool confirmed. Safer to trade.
```

---

### 4.6 Liquidity Depth — 10 points

Absolute TVL in the pool, log-scaled. Rewards tokens that have attracted real capital, without over-penalising new tokens with thin pools.

```
score = min(log10(max(liquidity, 1)) / log10(50_000), 1.0) × 10
```

| Liquidity | Score |
|-----------|-------|
| < $100 | ~0.5 |
| $500 | ~3.1 |
| $2,000 | ~5.1 |
| $10,000 | ~7.1 |
| $50,000+ | 10 (cap) |

---

### 4.7 Socials Completeness — 5 points

Presence check only. Not a quality signal — a Twitter with 12 followers still counts. Absence is the red flag.

```
score = 0
if twitter present:  score += 2
if telegram present: score += 2
if website present:  score += 1
```

A token with all three scores 5. A token with none scores 0 and also triggers the rug combo check (Section 8.1).

---

### 4.8 Buyer Rank + Returns — 5 points

Soft momentum signal. Combined from two sub-scores.

**Buyer rank (3 pts):** Earlier = more signal. Buyers under #50 are early adopters.

```
if buyerRank <= 10:    score = 3
if buyerRank <= 50:    score = 2
if buyerRank <= 200:   score = 1
else:                  score = 0
```

**Returns (2 pts):** Positive price action since launch.

```
returnPct = parseFloat(returns)   // e.g. "+45.2" → 45.2
if returnPct >= 50:    score = 2
if returnPct >= 10:    score = 1
if returnPct > 0:      score = 0.5
else:                  score = 0
```

---

## 5. Penalties

Penalties only subtract. Score floors at 0.

### 5.1 Rug Combo Penalty — −5 points

Fires only when **all three** of the following are true simultaneously. One or two alone is not enough to penalise.

```
condition_1: socials === 0           // No twitter, no telegram, no website
condition_2: holders < 20            // Almost no distribution
condition_3: liquidity < 2,000       // Essentially no pool

if (condition_1 && condition_2 && condition_3): score -= 5
```

This deliberately does not fire on new tokens that are simply small. A new token with Twitter + Telegram but only 8 holders and $400 liquidity is fine — only condition_1 would be false, so no penalty.

### 5.2 Concentration Penalty — −10 points

Requires the Solana RPC concentration check (Section 7). Fires when a single wallet holds an outsized share of the total supply.

```
top1Pct = top1WalletBalance / totalSupply × 100

if top1Pct >= 66:  penalty = 10   // Near-total control. Almost certain rug.
if top1Pct >= 50:  penalty = 7    // Majority holder. Very high risk.
if top1Pct >= 30:  penalty = 4    // Whale dominance. Significant risk.
if top1Pct < 30:   penalty = 0    // Acceptable for early-stage token.
```

Also check the top-5 combined:

```
top5Pct = sum(top5Balances) / totalSupply × 100

if top5Pct >= 80 AND top1Pct < 30:  penalty += 3  // Cabal / bundle pattern
```

**Important:** The LP (liquidity pool) token account will appear in the top-20 list. You must exclude addresses that are known program/pool addresses before calculating percentages. Filter out:
- Raydium AMM program accounts
- The token's own bonding curve account (Bags/pump.fun)
- Any account with address matching known DEX programs

---

## 6. Concentration Check Implementation

Two Solana RPC calls, run once per new mint and on-demand:

```typescript
async function getConcentrationFlag(
  mint: string,
  rpcUrl: string
): Promise<{ top1Pct: number; top5Pct: number; flag: boolean }> {

  // Call 1: Get total supply
  const supplyRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenSupply',
      params: [mint]
    })
  });
  const { result: supplyData } = await supplyRes.json();
  const totalSupply = Number(supplyData.value.amount);

  // Call 2: Get top 20 holders
  const holdersRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2,
      method: 'getTokenLargestAccounts',
      params: [mint]
    })
  });
  const { result: holdersData } = await holdersRes.json();

  // Known pool/program addresses to exclude
  const EXCLUDED = new Set([
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS', // ATA program
  ]);

  const accounts = (holdersData.value as Array<{ address: string; amount: string }>)
    .filter(a => !EXCLUDED.has(a.address));

  if (!accounts.length || totalSupply === 0) {
    return { top1Pct: 0, top5Pct: 0, flag: false };
  }

  const top1Pct = (Number(accounts[0].amount) / totalSupply) * 100;
  const top5Pct = accounts.slice(0, 5)
    .reduce((sum, a) => sum + Number(a.amount), 0) / totalSupply * 100;

  const flag = top1Pct >= 30 || top5Pct >= 80;

  return { top1Pct, top5Pct, flag };
}
```

Store results in a new column on `narrative_tokens`:

```sql
ALTER TABLE narrative_tokens ADD COLUMN top1_holder_pct numeric DEFAULT NULL;
ALTER TABLE narrative_tokens ADD COLUMN top5_holder_pct numeric DEFAULT NULL;
ALTER TABLE narrative_tokens ADD COLUMN concentration_flag boolean DEFAULT false;
```

---

## 7. Main Score Function

```typescript
interface TokenData {
  mcap: number;
  volume24h: number;
  liquidity: number;
  holders: number;
  lifecycle: 'PRE_LAUNCH' | 'PRE_GRAD' | 'MIGRATING' | 'MIGRATED';
  twitter?: string;
  telegram?: string;
  website?: string;
  buyerRank?: number;
  returns?: string;
  top1HolderPct?: number;   // From concentration check
  top5HolderPct?: number;   // From concentration check
}

function calculateScratchScore(token: TokenData): number {
  if (!token.mcap || token.lifecycle === 'PRE_LAUNCH') return 0;

  let score = 0;

  // 4.1 Vol / MCap ratio (30pts)
  const volMcapRatio = token.volume24h / token.mcap;
  score += Math.min(volMcapRatio / 2.0, 1.0) * 30;

  // 4.2 Holder distribution quality (15pts)
  const tierCap =
    token.mcap < 10_000    ? 50    :
    token.mcap < 100_000   ? 300   :
    token.mcap < 500_000   ? 1000  : 5000;
  let holderScore = Math.min(
    Math.log10(Math.max(token.holders, 1)) / Math.log10(tierCap),
    1.0
  ) * 15;
  // Halve if concentration flag is set
  if (token.top1HolderPct && token.top1HolderPct >= 30) {
    holderScore *= 0.5;
  }
  score += holderScore;

  // 4.3 Vol / Liquidity ratio (10pts)
  const volLiqRatio = token.volume24h / Math.max(token.liquidity, 1);
  score += Math.min(volLiqRatio / 5.0, 1.0) * 10;

  // 4.4 MCap tier fit (10pts)
  score +=
    token.mcap < 1_000      ? 4  :
    token.mcap < 5_000      ? 8  :
    token.mcap < 50_000     ? 9  :
    token.mcap < 500_000    ? 10 :
    token.mcap < 2_000_000  ? 7  : 3;

  // 4.5 Lifecycle (10pts)
  score +=
    token.lifecycle === 'MIGRATED'  ? 10 :
    token.lifecycle === 'MIGRATING' ? 8  :
    token.lifecycle === 'PRE_GRAD'  ? 7  : 0;

  // 4.6 Liquidity depth (10pts)
  score += Math.min(
    Math.log10(Math.max(token.liquidity, 1)) / Math.log10(50_000),
    1.0
  ) * 10;

  // 4.7 Socials (5pts)
  if (token.twitter)  score += 2;
  if (token.telegram) score += 2;
  if (token.website)  score += 1;

  // 4.8 Buyer rank (3pts)
  if (token.buyerRank) {
    score +=
      token.buyerRank <= 10  ? 3 :
      token.buyerRank <= 50  ? 2 :
      token.buyerRank <= 200 ? 1 : 0;
  }

  // 4.8 Returns (2pts)
  if (token.returns) {
    const ret = parseFloat(token.returns.replace('%', ''));
    score += ret >= 50 ? 2 : ret >= 10 ? 1 : ret > 0 ? 0.5 : 0;
  }

  // Penalty 5.1 — Rug combo
  const noSocials  = !token.twitter && !token.telegram && !token.website;
  const thinHolders = token.holders < 20;
  const thinPool    = token.liquidity < 2_000;
  if (noSocials && thinHolders && thinPool) score -= 5;

  // Penalty 5.2 — Concentration
  if (token.top1HolderPct !== undefined) {
    if (token.top1HolderPct >= 66)      score -= 10;
    else if (token.top1HolderPct >= 50) score -= 7;
    else if (token.top1HolderPct >= 30) score -= 4;

    if (token.top5HolderPct && token.top5HolderPct >= 80 && token.top1HolderPct < 30) {
      score -= 3;
    }
  }

  return Math.max(0, Math.round(score));
}
```

---

## 8. Score Benchmarks

### The "Perfect" Token (theoretical max ~92–95)

A perfect token at launch on this platform would look like:

| Metric | Value | Rationale |
|--------|-------|-----------|
| MCap | $4,000–$8,000 | Prime early-runner zone. Massive upside room. |
| Volume 24h | $8,000–$16,000 | 150–200% vol/mcap ratio. Insane velocity for size. |
| Liquidity | $800–$1,500 | Vol/liq ratio of ~10×, maxes that component |
| Holders | 12–25 | Genuine early community. Tier-adjusted, scores well. |
| Lifecycle | PRE_GRAD | Active bonding curve, hasn't graduated yet |
| Socials | All three | Twitter, Telegram, website all present |
| Top 1 holder | < 15% of supply | No whale / bundle control |
| Buyer rank | < 10 | Very early entrant |
| Returns | +60% in first hours | Price momentum confirmed |

**Expected score: ~88–94**

This is the signal the feed should be highlighting. The token hasn't graduated yet (can't get MIGRATED's 10pts) but everything else is maxed. At graduation it would tip to 92–95.

### Solana Ecosystem Benchmarks (May 2026 context)

Based on current Solana memecoin market data:

| Token stage | Typical mcap | Vol/mcap ratio | Approx score |
|-------------|-------------|----------------|--------------|
| Pre-launch ghost | $0 | — | 0 |
| Fresh launch, no traction | $1k–$3k | 5–15% | 15–30 |
| Early runner (target zone) | $3k–$50k | 80–200% | 65–88 |
| Mid-run momentum | $50k–$500k | 50–150% | 72–90 |
| Established (BONK tier) | $100M+ | 5–20% | 35–55 |
| Dead high-mcap | $500k–$5M | < 5% | 10–25 |

The established mega-caps like BONK and PENGU would score in the 35–55 range — not bad, but not high — because their vol/mcap ratios are low (a $2B token doesn't turn over 100% of its mcap daily). This is intentional: the score is designed to find *runners*, not *safe stores of value*.

---

## 9. Score Display on Feed

| Score | Label | Colour | Meaning |
|-------|-------|--------|---------|
| 80–95 | Hot | Green | Strong runner signal |
| 60–79 | Active | Teal | Worth watching |
| 40–59 | Quiet | Amber | Some activity, not moving yet |
| 20–39 | Cold | Grey | Very little signal |
| 0–19 | Dead | Red | No activity or flagged |

---

## 10. Supabase Integration

The score is stored in `narrative_tokens.score` (integer, 0–100). Update schedule:

- **On mint discovery:** run concentration check, store `top1_holder_pct`, `top5_holder_pct`, `concentration_flag`
- **Bags refresher (every 10 min):** recalculate score with latest `mcap`, `volume24h`, `liquidity`, `holders`
- **Concentration re-check:** only when `holders` changes by > 20% since last check (saves RPC calls)

```typescript
// In the Bags refresher loop (server/index.ts)
const concentrationData = await getConcentrationFlag(token.token_mint, process.env.HELIUS_RPC_URL);

const score = calculateScratchScore({
  mcap: token.current_mcap,
  volume24h: token.total_volume,
  liquidity: token.liquidity,
  holders: token.holders,
  lifecycle: token.lifecycle,
  twitter: token.twitter,
  telegram: token.telegram,
  website: token.website,
  buyerRank: token.buyer_rank,
  returns: token.returns,
  top1HolderPct: concentrationData.top1Pct,
  top5HolderPct: concentrationData.top5Pct,
});

await supabase
  .from('narrative_tokens')
  .update({
    score,
    top1_holder_pct: concentrationData.top1Pct,
    top5_holder_pct: concentrationData.top5Pct,
    concentration_flag: concentrationData.flag,
  })
  .eq('token_mint', token.token_mint);
```

---

## 11. Known Limitations

1. **Bags holder count lag:** The `holders` field from Bags can be stale by 5–15 minutes. The score reflects this with a slight delay on holder-sensitive moves.

2. **Wash trading:** Vol/mcap and vol/liq ratios can be inflated by a bot trading against itself. The concentration check partially catches this (same wallet buying and selling), but a well-distributed wash-trade ring still passes. This is a hard problem without Jito bundle-level data.

3. **No age signal:** The scoring system does not directly factor in token age because Bags does not reliably expose `createdAt` on pool data. Age would be a useful additional normalisation factor — a 2-hour-old token with 100% vol/mcap is more impressive than a 2-week-old token with the same ratio. Add this when `launched_at` from the `narrative_tokens` table is reliably populated.

4. **Concentration check requires Helius RPC:** The two RPC calls for `getTokenLargestAccounts` and `getTokenSupply` need a Helius API key or equivalent. Add `HELIUS_RPC_URL` to `.env` and the Railway environment. The free Helius tier supports this easily at our refresh volume.

5. **LP address exclusion is incomplete:** The excluded address set in the concentration check only covers Raydium AMM. Add Orca, Bags' own bonding curve address, and any other pool programs that tokens on this platform graduate through.

---

*End of document. Questions → check server logs or ping the dev team.*
