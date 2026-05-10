/**
 * Score Audit v2 — pulls real tokens from narrative_tokens, enriches them
 * with live DexScreener data, and re-scores with the new formula.
 *
 * Usage:  npx tsx server/score-audit.ts
 * This does NOT modify any data.
 */
import "./loadEnv";
import { supabase } from "./supabaseClient";
import { calculateScratchScore, type TokenData } from "./scoring";
import { fetchDexScreenerData } from "./dexscreener";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Pull top 5 + latest 5, dedupe
  const { data: topRows } = await supabase
    .from("narrative_tokens")
    .select("*")
    .not("token_mint", "is", null)
    .order("score", { ascending: false })
    .limit(5);

  const { data: latestRows } = await supabase
    .from("narrative_tokens")
    .select("*")
    .not("token_mint", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const rows = [...(topRows ?? []), ...(latestRows ?? [])];
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log(`\n${"=".repeat(80)}`);
  console.log(`SCORE AUDIT v2 — ${unique.length} tokens (DexScreener-enriched)`);
  console.log(`${"=".repeat(80)}\n`);

  for (const row of unique) {
    const r = row as Record<string, any>;
    const mint = r.token_mint;
    console.log(`\n${"─".repeat(80)}`);
    console.log(`TOKEN: ${r.token_ticker || r.token_name || "UNKNOWN"} (${mint})`);
    console.log(`DB Row ID: ${r.id} | OLD stored score: ${r.score} | is_on_bags: ${r.is_on_bags}`);
    console.log(`${"─".repeat(80)}`);

    // Fetch live DexScreener data
    const dex = await fetchDexScreenerData(mint);
    console.log("\n  DEXSCREENER DATA:");
    console.log(`    mcap:            ${dex.mcap}`);
    console.log(`    volume24h:       ${dex.volume24h}`);
    console.log(`    liquidity:       ${dex.liquidity}`);
    console.log(`    priceChange24h:  ${dex.priceChange24h}`);
    console.log(`    txns24h:         ${dex.txns24h}`);
    console.log(`    pairCreatedAt:   ${dex.pairCreatedAt ? new Date(dex.pairCreatedAt).toISOString() : "null"}`);
    console.log(`    hasSocials:      ${dex.hasSocials}`);
    console.log(`    socialLinks:     ${JSON.stringify(dex.socialLinks)}`);

    // Build TokenData with DexScreener + DB fallbacks
    const top1 = r.top1_holder_pct != null ? Number(r.top1_holder_pct) : undefined;
    const top5 = r.top5_holder_pct != null ? Number(r.top5_holder_pct) : undefined;
    const tokenData: TokenData = {
      mcap: (dex.mcap ?? Number(r.current_mcap)) || 0,
      volume24h: (dex.volume24h ?? Number(r.total_volume)) || 0,
      liquidity: (dex.liquidity ?? Number(r.liquidity)) || 0,
      holders: Number(r.holders) || 0,
      hasSocials: dex.hasSocials,
      priceChange24h: dex.priceChange24h ?? undefined,
      pairCreatedAt: dex.pairCreatedAt,
      txns24h: dex.txns24h,
      top1HolderPct: top1,
      top5HolderPct: top5,
      jupiterVerified: r.jupiter_verified === true,
    };

    console.log("\n  TOKENDATA (as passed to calculateScratchScore):");
    console.log(`    mcap:            ${tokenData.mcap}`);
    console.log(`    volume24h:       ${tokenData.volume24h}`);
    console.log(`    liquidity:       ${tokenData.liquidity}`);
    console.log(`    holders:         ${tokenData.holders}`);
    console.log(`    hasSocials:      ${tokenData.hasSocials}`);
    console.log(`    priceChange24h:  ${tokenData.priceChange24h ?? "(undefined)"}`);
    console.log(`    pairCreatedAt:   ${tokenData.pairCreatedAt ?? "(null)"}`);
    console.log(`    txns24h:         ${tokenData.txns24h ?? "(null)"}`);
    console.log(`    top1HolderPct:   ${tokenData.top1HolderPct ?? "(undefined)"}`);
    console.log(`    top5HolderPct:   ${tokenData.top5HolderPct ?? "(undefined)"}`);
    console.log(`    jupiterVerified: ${tokenData.jupiterVerified}`);

    // Step-by-step scoring
    console.log("\n  STEP-BY-STEP SCORING (v2):");
    let score = 0;

    if (!tokenData.mcap && !tokenData.volume24h && !tokenData.liquidity && !tokenData.holders) {
      console.log("    >>> EARLY EXIT: all core fields are 0 → score = 0");
      const newScore = calculateScratchScore(tokenData);
      console.log(`\n    NEW SCORE: ${newScore} | OLD STORED: ${r.score}`);
      await sleep(300);
      continue;
    }

    // 1. Vol/MCap (25pts, threshold 0.5)
    let s1 = 0;
    if (tokenData.mcap > 0) {
      const ratio = tokenData.volume24h / tokenData.mcap;
      s1 = Math.min(ratio / 0.5, 1.0) * 25;
      console.log(`    1. Vol/MCap: ${tokenData.volume24h.toFixed(0)} / ${tokenData.mcap.toFixed(0)} = ${ratio.toFixed(4)} → min(${(ratio/0.5).toFixed(4)}, 1) × 25 = ${s1.toFixed(2)}`);
    } else {
      console.log(`    1. Vol/MCap: mcap=0 → 0`);
    }
    score += s1;

    // 2. Holders (15pts)
    let s2 = 0;
    if (tokenData.holders > 0 && tokenData.mcap > 0) {
      const tierCap =
        tokenData.mcap < 10_000 ? 50 :
        tokenData.mcap < 100_000 ? 300 :
        tokenData.mcap < 500_000 ? 1000 : 5000;
      const raw = Math.min(Math.log10(Math.max(tokenData.holders, 1)) / Math.log10(tierCap), 1.0) * 15;
      const halved = top1 !== undefined && top1 >= 30;
      s2 = halved ? raw * 0.5 : raw;
      console.log(`    2. Holders: ${tokenData.holders}, tierCap=${tierCap}, raw=${raw.toFixed(2)}${halved ? " → HALVED" : ""} = ${s2.toFixed(2)}`);
    } else {
      console.log(`    2. Holders: skipped → 0`);
    }
    score += s2;

    // 3. Social presence (10pts)
    const s3 = tokenData.hasSocials ? 10 : 0;
    console.log(`    3. Social presence: ${tokenData.hasSocials} → ${s3}`);
    score += s3;

    // 4. Vol/Liq (10pts)
    let s4 = 0;
    if (tokenData.liquidity > 0 && tokenData.volume24h) {
      const ratio = tokenData.volume24h / Math.max(tokenData.liquidity, 1);
      s4 = Math.min(ratio / 5.0, 1.0) * 10;
      console.log(`    4. Vol/Liq: ${ratio.toFixed(4)} → ${s4.toFixed(2)}`);
    } else {
      console.log(`    4. Vol/Liq: skipped → 0`);
    }
    score += s4;

    // 5. MCap tier (10pts)
    let s5 = 0;
    if (tokenData.mcap > 0) {
      s5 = tokenData.mcap < 1_000 ? 4 :
           tokenData.mcap < 5_000 ? 8 :
           tokenData.mcap < 50_000 ? 9 :
           tokenData.mcap < 500_000 ? 10 :
           tokenData.mcap < 2_000_000 ? 7 : 3;
      console.log(`    5. MCap tier: $${tokenData.mcap.toFixed(0)} → ${s5}`);
    } else {
      console.log(`    5. MCap tier: 0 → 0`);
    }
    score += s5;

    // 6. Liq depth (10pts)
    let s6 = 0;
    if (tokenData.liquidity > 0) {
      s6 = Math.min(Math.log10(Math.max(tokenData.liquidity, 1)) / Math.log10(50_000), 1.0) * 10;
      console.log(`    6. Liq depth: $${tokenData.liquidity.toFixed(0)} → ${s6.toFixed(2)}`);
    } else {
      console.log(`    6. Liq depth: 0 → 0`);
    }
    score += s6;

    // 7. Token age (8pts)
    let s7 = 0;
    if (tokenData.pairCreatedAt && tokenData.pairCreatedAt > 0) {
      const ageHours = (Date.now() - tokenData.pairCreatedAt) / (1000 * 60 * 60);
      s7 = ageHours < 1 ? 0 : ageHours < 6 ? 3 : ageHours < 24 ? 5 : ageHours < 168 ? 8 : 6;
      console.log(`    7. Token age: ${ageHours.toFixed(1)}h → ${s7}`);
    } else {
      console.log(`    7. Token age: unknown → 0`);
    }
    score += s7;

    // 8. Price momentum (7pts)
    let s8 = 0;
    if (tokenData.priceChange24h !== undefined && tokenData.priceChange24h !== null) {
      s8 = tokenData.priceChange24h >= 100 ? 7 :
           tokenData.priceChange24h >= 50 ? 5 :
           tokenData.priceChange24h >= 20 ? 3 :
           tokenData.priceChange24h > 0 ? 1 : 0;
      console.log(`    8. Price momentum: ${tokenData.priceChange24h.toFixed(1)}% → ${s8}`);
    } else {
      console.log(`    8. Price momentum: no data → 0`);
    }
    score += s8;

    // 9. Jupiter verified (3pts)
    const s9 = tokenData.jupiterVerified ? 3 : 0;
    console.log(`    9. Jupiter verified: ${tokenData.jupiterVerified} → ${s9}`);
    score += s9;

    // 10. Txn activity (2pts)
    let s10 = 0;
    if (tokenData.txns24h != null && tokenData.txns24h > 0) {
      s10 = tokenData.txns24h >= 100 ? 2 : tokenData.txns24h >= 10 ? 1 : 0;
      console.log(`    10. Txn activity: ${tokenData.txns24h} txns → ${s10}`);
    } else {
      console.log(`    10. Txn activity: no data → 0`);
    }
    score += s10;

    // Penalties
    const thinHolders = tokenData.holders > 0 && tokenData.holders < 20;
    const thinPool = tokenData.liquidity > 0 && tokenData.liquidity < 2_000;
    let p1 = 0;
    if (!tokenData.hasSocials && thinHolders && thinPool) p1 = -5;
    console.log(`    P1. Rug combo: noSocials=${!tokenData.hasSocials}, thinHolders=${thinHolders}, thinPool=${thinPool} → ${p1}`);
    score += p1;

    let p2 = 0;
    if (top1 !== undefined) {
      if (top1 >= 66) p2 = -10;
      else if (top1 >= 50) p2 = -7;
      else if (top1 >= 30) p2 = -4;
      if (top5 && top5 >= 80 && top1 < 30) p2 -= 3;
      console.log(`    P2. Concentration: top1=${top1.toFixed(1)}%, top5=${top5?.toFixed(1) ?? "?"}% → ${p2}`);
    } else {
      console.log(`    P2. Concentration: no data → 0`);
    }
    score += p2;

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const verifyScore = calculateScratchScore(tokenData);

    console.log(`\n    SUBTOTAL: ${score.toFixed(2)}`);
    console.log(`    CLAMPED:  ${finalScore}`);
    console.log(`    VERIFY (calculateScratchScore): ${verifyScore}`);
    console.log(`    OLD STORED SCORE: ${r.score}`);
    console.log(`    IMPROVEMENT: ${r.score} → ${verifyScore} (${verifyScore > r.score ? "+" : ""}${verifyScore - r.score})`);

    // Be polite to DexScreener
    await sleep(300);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("AUDIT v2 COMPLETE");
  console.log(`${"=".repeat(80)}\n`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
