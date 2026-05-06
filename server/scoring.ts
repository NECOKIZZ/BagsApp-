
export interface TokenData {
  // Core market signals — available from both Bags and Jupiter
  mcap: number;
  volume24h: number;
  liquidity: number;
  holders: number;

  // Bags-specific signals — null/undefined for Jupiter-only tokens.
  // The formula treats missing values as zero contribution rather than
  // disqualifying the token, so any source can produce a real score.
  lifecycle?: 'PRE_LAUNCH' | 'PRE_GRAD' | 'MIGRATING' | 'MIGRATED';
  twitter?: string;
  telegram?: string;
  website?: string;
  buyerRank?: number;
  returns?: string;
  top1HolderPct?: number;   // From concentration check (Bags + Helius RPC)
  top5HolderPct?: number;

  // Jupiter-specific signals — null/undefined for pure-Bags scoring.
  // Provide a parallel safety/quality signal when on-chain data isn't
  // accessible (Jupiter exposes verified + organicScore in lieu of socials/lifecycle).
  jupiterVerified?: boolean;
  jupiterOrganicScore?: number; // 0-100 from Jupiter's algo
}

/**
 * Unified Scratch Score (0-100). Works for both Bags and Jupiter-sourced tokens.
 *
 * Design:
 *  - Core market signals (mcap/volume/liquidity/holders) carry the bulk of the
 *    weight (75pts) because they're available everywhere.
 *  - Bags-only signals (lifecycle, socials, buyer rank, concentration) add up
 *    to ~25pts when present. A Bags token with full data can hit 100.
 *  - Jupiter-only signals (verified, organicScore) substitute up to 15pts
 *    when Bags signals are absent — so a high-quality Jupiter token can still
 *    reach 80+, but won't fake the top end of the scale reserved for
 *    on-chain-validated Bags tokens.
 *  - Missing fields contribute 0 instead of returning early, so we never
 *    blank-score a token just because part of the data is unavailable.
 */
export function calculateScratchScore(token: TokenData): number {
  // Genuine "no data" guard — only when we have literally nothing to score.
  if (!token.mcap && !token.volume24h && !token.liquidity && !token.holders) {
    return 0;
  }

  let score = 0;

  // 4.1 Vol / MCap ratio (30pts) — trading velocity vs token size
  if (token.mcap > 0) {
    const volMcapRatio = (token.volume24h ?? 0) / token.mcap;
    score += Math.min(volMcapRatio / 2.0, 1.0) * 30;
  }

  // 4.2 Holder distribution quality (15pts)
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

  // 4.3 Vol / Liquidity ratio (10pts) — pool health/velocity
  if (token.liquidity > 0 && token.volume24h !== undefined) {
    const volLiqRatio = token.volume24h / Math.max(token.liquidity, 1);
    score += Math.min(volLiqRatio / 5.0, 1.0) * 10;
  }

  // 4.4 MCap tier fit (10pts) — rewards early-mid stage with upside
  if (token.mcap > 0) {
    score +=
      token.mcap < 1_000      ? 4  :
      token.mcap < 5_000      ? 8  :
      token.mcap < 50_000     ? 9  :
      token.mcap < 500_000    ? 10 :
      token.mcap < 2_000_000  ? 7  : 3;
  }

  // 4.5 Lifecycle (10pts) — Bags-only on-chain milestones.
  // Missing lifecycle no longer disqualifies; just contributes 0.
  if (token.lifecycle) {
    score +=
      token.lifecycle === 'MIGRATED'   ? 10 :
      token.lifecycle === 'MIGRATING'  ? 8  :
      token.lifecycle === 'PRE_GRAD'   ? 7  :
      token.lifecycle === 'PRE_LAUNCH' ? 0  : 0;
  }

  // 4.6 Liquidity depth (10pts) — absolute pool size, log-scaled
  if (token.liquidity > 0) {
    score += Math.min(
      Math.log10(Math.max(token.liquidity, 1)) / Math.log10(50_000),
      1.0,
    ) * 10;
  }

  // 4.7 Socials (5pts) — Bags-only. Jupiter doesn't return these.
  if (token.twitter)  score += 2;
  if (token.telegram) score += 2;
  if (token.website)  score += 1;

  // 4.8 Buyer rank (3pts) — Bags-only
  if (token.buyerRank) {
    score +=
      token.buyerRank <= 10  ? 3 :
      token.buyerRank <= 50  ? 2 :
      token.buyerRank <= 200 ? 1 : 0;
  }

  // 4.9 Returns (2pts)
  if (token.returns) {
    const ret = parseFloat(token.returns.replace('%', '').replace('+', ''));
    if (Number.isFinite(ret)) {
      score += ret >= 50 ? 2 : ret >= 10 ? 1 : ret > 0 ? 0.5 : 0;
    }
  }

  // 4.10 Jupiter quality bonus (up to 15pts) — partially substitutes for the
  // lifecycle/socials/buyer-rank signals that Jupiter doesn't expose. Capped
  // so it can't push a Jupiter-only token to a perfect score.
  if (token.jupiterVerified) score += 5;
  if (token.jupiterOrganicScore !== undefined) {
    score += Math.min(10, token.jupiterOrganicScore / 10);
  }

  // --- Penalties ---

  // 5.1 Rug combo (-5pts) — only fire when we have data to judge
  const noSocials   = !token.twitter && !token.telegram && !token.website;
  const thinHolders = token.holders > 0 && token.holders < 20;
  const thinPool    = token.liquidity > 0 && token.liquidity < 2_000;
  if (noSocials && thinHolders && thinPool) score -= 5;

  // 5.2 Concentration (-10pts)
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
