# Delphi Token Scoring System (v2)

> **Version:** 2.0  
> **Formula:** `server/scoring.ts` → `calculateScratchScore()`  
> **Primary Data Source:** DexScreener API (free, no API key)  
> **Fallbacks:** Bags API, Jupiter API, Solana RPC  
> **Score Range:** 0–100 (clamped)

---

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌──────────┐     ┌─────┐
│ DexScreener API │────▶│ scoring.ts   │────▶│ Supabase │────▶│ UI  │
│ (primary)       │     │ v2 formula   │     │ DB       │     │     │
└─────────────────┘     └──────────────┘     └──────────┘     └─────┘
        ▲                                              │
        │                    ┌──────────────┐           ▼
        │                    │ Bags API     │     ┌──────────────┐
        └────────────────────│ (fallback)   │────▶│ /api/feed    │
                             │ Jupiter API  │     │ /api/token   │
                             │ Solana RPC   │     │ :mint/metrics │
                             └──────────────┘     └──────────────┘
```

---

## Data Sources

### 1. DexScreener API (Primary)
```
GET https://api.dexscreener.com/latest/dex/tokens/{mint}
```

| Field | Source Path | Type |
|-------|-------------|------|
| `mcap` | `fdv` or `marketCap` | `number` |
| `volume24h` | `volume.h24` | `number` |
| `liquidity` | `liquidity.usd` | `number` |
| `priceChange24h` | `priceChange.h24` | `number` |
| `txns24h` | `txns.h24.buys + txns.h24.sells` | `number` |
| `pairCreatedAt` | `pairCreatedAt` | `epoch ms` |
| `hasSocials` | `info.socials[].type` or `info.websites[].url` | `boolean` |

**Rate limit:** ~300 req/min (generous).  
**Strategy:** For tokens with multiple pools, picks the pair with highest liquidity.

### 2. Bags API (Fallback — `is_on_bags=true` tokens)
- `marketCapUsd`, `volume24hUsd`, `liquidity`, `holders`
- Enriched with DexScreener for socials, age, price change, txns

### 3. Solana RPC (Concentration analysis)
- `getTokenSupply` → total supply
- `getTokenLargestAccounts` → top holders
- Excludes known program addresses (Raydium AMM, ATA program, etc.)

---

## Scoring Formula (100-Point System)

### Positive Components

| # | Component | Max Pts | Formula | Threshold |
|---|-----------|---------|---------|-----------|
| 1 | **Vol / MCap ratio** | 25 | `min(vol24h/mcap / 0.5, 1.0) × 25` | 50% of mcap = full marks |
| 2 | **Holder distribution** | 15 | `log10(holders)/log10(tierCap) × 15` | tierCap = 50–5000 based on mcap |
| 3 | **Social presence** | 10 | Binary: `hasSocials ? 10 : 0` | Any twitter/telegram/website link |
| 4 | **Vol / Liquidity ratio** | 10 | `min(vol24h/liquidity / 5.0, 1.0) × 10` | 5× turnover = full marks |
| 5 | **MCap tier** | 10 | Step function (see below) | $50K–$500K = full marks (10) |
| 6 | **Liquidity depth** | 10 | `log10(liquidity)/log10(50K) × 10` | $50K = full marks |
| 7 | **Token age** | 8 | Step: 1h→0, 6h→3, 24h→5, 7d→8 | Older tokens score higher |
| 8 | **Price momentum 24h** | 7 | Step: +20%→3, +50%→5, +100%→7 | Positive price change only |
| 9 | **Jupiter verified** | 3 | Binary: `jupiterVerified ? 3 : 0` | Jupiter's vetting badge |
| 10 | **Transaction activity** | 2 | `txns≥100 → 2, txns≥10 → 1` | 24h buy+sell count |

#### MCap Tier Detail (Component 5)
```
mcap < $1K       → 4 pts
mcap < $5K       → 8 pts
mcap < $50K      → 9 pts
mcap < $500K     → 10 pts  ← sweet spot
mcap < $2M       → 7 pts
mcap ≥ $2M       → 3 pts
```

#### Holder Tier Caps (Component 2)
```
mcap < $10K      → tierCap = 50
mcap < $100K     → tierCap = 300
mcap < $500K     → tierCap = 1000
mcap ≥ $500K     → tierCap = 5000
```

### Penalties

| Penalty | Condition | Deduction |
|---------|-----------|-----------|
| **P1. Rug combo** | No socials AND <20 holders AND <$2K liquidity | −5 |
| **P2. Concentration** | top1 ≥ 66% | −10 |
| | top1 ≥ 50% | −7 |
| | top1 ≥ 30% | −4 |
| | top5 ≥ 80% (only if top1 < 30%) | −3 |

### Early Exit
```typescript
if (!mcap && !volume24h && !liquidity && !holders) return 0;
```
If all four core fields are zero/null, score = 0 (no market data available).

---

## Score Flow to Database

### Supabase Columns Updated by Scoring

| Column | Source | Used In |
|--------|--------|---------|
| `score` | `calculateScratchScore()` | Terminal ranking, feed cards, detail page |
| `returns` | DexScreener `priceChange24h` formatted | Terminal `change24h` column, feed badges |
| `launched_at` | DexScreener `pairCreatedAt` | Terminal `time` column, age display |
| `current_mcap` | DexScreener / Bags / DB | Detail page market cap |
| `current_price` | DexScreener / Bags / DB | Detail page price |
| `total_volume` | DexScreener / Bags / DB | Detail page volume |
| `liquidity` | DexScreener / Bags / DB | Detail page liquidity |
| `holders` | Bags / RPC | Detail page holder count |
| `top1_holder_pct` | Solana RPC | Concentration penalty |
| `top5_holder_pct` | Solana RPC | Concentration penalty |

### Update Triggers (3 paths)

1. **Cron: `refreshBagsTokenStatsOnce`** — every 10 min  
   - Targets `is_on_bags=true` tokens  
   - Bags pool + DexScreener → score → write to DB

2. **Cron: `refreshTokenMetricsOnce`** — every 5 min  
   - Targets **ALL** `narrative_tokens` (oldest `updated_at` first)  
   - DexScreener only → score → write to DB  
   - Skips tokens with no DexScreener data (doesn't overwrite with zeros)

3. **On-demand: `/api/token/:mint/metrics`**  
   - Live DexScreener fetch + re-score  
   - Persisted to DB (fire-and-forget)  
   - Ensures detail page always shows fresh score

---

## What a 75+ Token Looks Like

```
mcap:            $200,000+                    → 10 pts (tier)
volume24h:       $100,000+ (50%+ of mcap)     → 25 pts (vol/mcap)
liquidity:       $50,000+                     → 10 pts (depth)
holders:         500+ with top1 < 30%        → 15 pts (distribution)
hasSocials:      true (any link)              → 10 pts (socials)
pairCreatedAt:   > 30 days old                → 8 pts (age)
priceChange24h:  +5% to +30%                  → 5-7 pts (momentum)
txns24h:         100+                         → 2 pts (activity)
jupiterVerified: true                         → 3 pts (verified)
                                              ─────────
                                              ~90-98 pts
```

### Realistic 50+ Token
```
mcap: $50K, volume: $25K (50% ratio), liq: $20K, holders: 200
hasSocials: true, age: 2 weeks, priceChange: +10%, txns: 50
→ Score: ~52-58
```

---

## UI Score Labels

```typescript
score ≥ 80  → "Hot"     (green #1D9E75)
score ≥ 60  → "Active"  (teal #5DCAA5)
score ≥ 40  → "Quiet"   (amber #EF9F27)
score ≥ 20  → "Cold"    (grey #71717A)
score < 20  → "Dead"    (red #EF4444)
```

---

## Key Files

| File | Role |
|------|------|
| `server/scoring.ts` | `calculateScratchScore()` + `getConcentrationData()` + `getScoreLabel()` |
| `server/dexscreener.ts` | `fetchDexScreenerData()` — DexScreener API client |
| `server/narrativePipeline.ts` | Pipeline that runs scoring when tweets arrive |
| `server/index.ts` | Crons (`refreshBagsTokenStatsOnce`, `refreshTokenMetricsOnce`) + metrics endpoint |

---

## Audit

Run the live score audit against your database:

```bash
npx tsx server/score-audit.ts
```

This fetches all `narrative_tokens`, re-scores them with the current formula, and prints a distribution report.
