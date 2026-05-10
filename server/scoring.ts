
export interface TokenData {
  // Core market signals — sourced from DexScreener (primary) or Bags pool API (fallback)
  mcap: number;
  volume24h: number;
  liquidity: number;
  holders: number;

  // Social presence — single boolean from DexScreener's info.socials / info.websites
  hasSocials?: boolean;

  // Price momentum — 24h price change % from DexScreener
  priceChange24h?: number;

  // Token age — epoch ms of pair creation from DexScreener's pairCreatedAt
  pairCreatedAt?: number | null;

  // Transaction activity — 24h buy+sell count from DexScreener
  txns24h?: number | null;

  // Concentration — from Solana RPC getTokenLargestAccounts
  top1HolderPct?: number;
  top5HolderPct?: number;

  // Jupiter verified badge — small bonus for tokens Jupiter has vetted
  jupiterVerified?: boolean;
}

/**
 * Unified Scratch Score v2 (0-100).
 *
 * Powered primarily by DexScreener data (free, no key, real volume/socials/age).
 * Falls back gracefully when fields are missing — 0 contribution, not disqualification.
 *
 * Weight table:
 *   1. Vol / MCap ratio      25pts  — trading velocity (threshold: vol = 50% mcap for full)
 *   2. Holder distribution   15pts  — log-scaled, halved if top1 >= 30%
 *   3. Social presence       10pts  — boolean: has ANY social link (DexScreener)
 *   4. Vol / Liquidity ratio 10pts  — pool turnover
 *   5. MCap tier fit         10pts  — rewards $50K–$500K sweet spot
 *   6. Liquidity depth       10pts  — log-scaled, $50K = full marks
 *   7. Token age / maturity   8pts  — from DexScreener pairCreatedAt
 *   8. Price momentum 24h     7pts  — from DexScreener priceChange.h24
 *   9. Jupiter verified        3pts  — bonus for Jupiter-vetted tokens
 *  10. Transaction activity    2pts  — 24h buy+sell count from DexScreener
 *                           ─────
 *  Positive max:            100pts
 *  P1. Rug combo penalty     -5pts  — no socials + <20 holders + <$2K liq
 *  P2. Concentration penalty -10pts — top1 holder dominance
 */
export function calculateScratchScore(token: TokenData): number {
  // Genuine "no data" guard — only when we have literally nothing to score.
  if (!token.mcap && !token.volume24h && !token.liquidity && !token.holders) {
    return 0;
  }

  let score = 0;

  // 1. Vol / MCap ratio (25pts) — trading velocity vs token size
  //    Full marks when volume24h >= 50% of mcap (lowered from 200% — realistic threshold).
  if (token.mcap > 0) {
    const volMcapRatio = (token.volume24h ?? 0) / token.mcap;
    score += Math.min(volMcapRatio / 0.5, 1.0) * 25;
  }

  // 2. Holder distribution quality (15pts)
  if (token.holders > 0 && token.mcap > 0) {
    const tierCap =
      token.mcap < 10_000    ? 50    :
      token.mcap < 100_000   ? 300   :
      token.mcap < 500_000   ? 1000  : 5000;

    let holderScore = Math.min(
      Math.log10(Math.max(token.holders, 1)) / Math.log10(tierCap),
      1.0,
    ) * 15;

    // Halve if concentration is high (only when we have concentration data).
    if (token.top1HolderPct !== undefined && token.top1HolderPct >= 30) {
      holderScore *= 0.5;
    }
    score += holderScore;
  }

  // 3. Social presence (10pts) — boolean: does the token have ANY social link?
  //    Sourced from DexScreener info.socials / info.websites.
  if (token.hasSocials) {
    score += 10;
  }

  // 4. Vol / Liquidity ratio (10pts) — pool health/velocity
  if (token.liquidity > 0 && token.volume24h !== undefined) {
    const volLiqRatio = token.volume24h / Math.max(token.liquidity, 1);
    score += Math.min(volLiqRatio / 5.0, 1.0) * 10;
  }

  // 5. MCap tier fit (10pts) — rewards early-mid stage with upside
  if (token.mcap > 0) {
    score +=
      token.mcap < 1_000      ? 4  :
      token.mcap < 5_000      ? 8  :
      token.mcap < 50_000     ? 9  :
      token.mcap < 500_000    ? 10 :
      token.mcap < 2_000_000  ? 7  : 3;
  }

  // 6. Liquidity depth (10pts) — absolute pool size, log-scaled
  if (token.liquidity > 0) {
    score += Math.min(
      Math.log10(Math.max(token.liquidity, 1)) / Math.log10(50_000),
      1.0,
    ) * 10;
  }

  // 7. Token age / maturity (8pts) — from DexScreener pairCreatedAt
  if (token.pairCreatedAt && token.pairCreatedAt > 0) {
    const ageMs = Date.now() - token.pairCreatedAt;
    const ageHours = ageMs / (1000 * 60 * 60);
    score +=
      ageHours < 1    ? 0 :
      ageHours < 6    ? 3 :
      ageHours < 24   ? 5 :
      ageHours < 168  ? 8 : 6;  // 168h = 7 days
  }

  // 8. Price momentum 24h (7pts) — from DexScreener priceChange.h24
  if (token.priceChange24h !== undefined && token.priceChange24h !== null) {
    score +=
      token.priceChange24h >= 100 ? 7 :
      token.priceChange24h >= 50  ? 5 :
      token.priceChange24h >= 20  ? 3 :
      token.priceChange24h > 0    ? 1 : 0;
  }

  // 9. Jupiter verified (3pts) — small bonus for tokens Jupiter has vetted
  if (token.jupiterVerified) score += 3;

  // 10. Transaction activity (2pts) — 24h buy+sell count from DexScreener
  if (token.txns24h != null && token.txns24h > 0) {
    score += token.txns24h >= 100 ? 2 : token.txns24h >= 10 ? 1 : 0;
  }

  // --- Penalties ---

  // P1. Rug combo (-5pts) — no socials + few holders + tiny pool
  const thinHolders = token.holders > 0 && token.holders < 20;
  const thinPool    = token.liquidity > 0 && token.liquidity < 2_000;
  if (!token.hasSocials && thinHolders && thinPool) score -= 5;

  // P2. Concentration (-10pts)
  if (token.top1HolderPct !== undefined) {
    if (token.top1HolderPct >= 66)      score -= 10;
    else if (token.top1HolderPct >= 50) score -= 7;
    else if (token.top1HolderPct >= 30) score -= 4;

    if (token.top5HolderPct && token.top5HolderPct >= 80 && token.top1HolderPct < 30) {
      score -= 3;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Normalize Bags lifecycle values to the scoring enum.
 * Bags uses its own terminology; this maps whatever it returns
 * to the 4 canonical values the formula understands.
 */
export function normalizeBagsLifecycle(raw: unknown): 'PRE_LAUNCH' | 'PRE_GRAD' | 'MIGRATING' | 'MIGRATED' | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (v === "MIGRATED" || v === "GRADUATED" || v === "LIVE" || v === "COMPLETE" || v === "DONE" || v === "FINISHED" || v === "POST_MIGRATION") {
    return "MIGRATED";
  }
  if (v === "MIGRATING" || v === "IN_MIGRATION" || v === "MIGRATION" || v === "TRANSITIONING" || v === "POST_GRAD") {
    return "MIGRATING";
  }
  if (v === "PRE_GRAD" || v === "PREGRAD" || v === "BONDING" || v === "BONDING_CURVE" || v === "CURVE" || v === "ACTIVE" || v === "PRE_MIGRATION" || v === "PRE_GRADUATION") {
    return "PRE_GRAD";
  }
  if (v === "PRE_LAUNCH" || v === "PRELAUNCH" || v === "PENDING" || v === "UPCOMING" || v === "NOT_STARTED" || v === "DRAFT") {
    return "PRE_LAUNCH";
  }
  // If Bags returns something we don't recognize, return undefined so the
  // formula treats it as missing (0 pts) rather than guessing wrong.
  return undefined;
}

/**
 * Maps a numerical score to a label and color for the UI.
 */
export function getScoreLabel(score: number): { label: string, color: string } {
  if (score >= 80) return { label: 'Hot', color: '#1D9E75' }; // Green
  if (score >= 60) return { label: 'Active', color: '#5DCAA5' }; // Teal
  if (score >= 40) return { label: 'Quiet', color: '#EF9F27' }; // Amber
  if (score >= 20) return { label: 'Cold', color: '#71717A' }; // Grey
  return { label: 'Dead', color: '#EF4444' }; // Red
}

/**
 * Solana RPC Concentration Check
 */
export async function getConcentrationData(
  mint: string,
  rpcUrl: string
): Promise<{ top1Pct: number; top5Pct: number; flag: boolean }> {
  try {
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
    const supplyJson = await supplyRes.json();
    if (!supplyJson.result) return { top1Pct: 0, top5Pct: 0, flag: false };
    
    const totalSupply = Number(supplyJson.result.value.amount);
    if (totalSupply === 0) return { top1Pct: 0, top5Pct: 0, flag: false };

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
    const holdersJson = await holdersRes.json();
    if (!holdersJson.result) return { top1Pct: 0, top5Pct: 0, flag: false };

    // Known pool/program addresses to exclude (Raydium, Pump.fun, etc.)
    const EXCLUDED = new Set([
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS', // ATA program
      '5Q544fKrMJuWJpS7S3R4Z96DGYp832D4pU7G6q5V7G7G', // Raydium Authority
      'CPMMoo8L3F4NbTga2peziFHboBMasV2CMe4nNJQBE1B',   // Raydium CPMM
    ]);

    const rawAccounts = (holdersJson.result.value as Array<{ address: string; amount: string }>);
    const accounts = rawAccounts.filter(a => !EXCLUDED.has(a.address));

    if (!accounts.length) {
      return { top1Pct: 0, top5Pct: 0, flag: false };
    }

    const top1Pct = (Number(accounts[0].amount) / totalSupply) * 100;
    const top5Pct = accounts.slice(0, 5)
      .reduce((sum, a) => sum + Number(a.amount), 0) / totalSupply * 100;

    const flag = top1Pct >= 30 || top5Pct >= 80;

    return { top1Pct, top5Pct, flag };
  } catch (e) {
    console.error(`[concentration-check] failed for ${mint}:`, e);
    return { top1Pct: 0, top5Pct: 0, flag: false };
  }
}
