import "./loadEnv";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ENV_PROJECT_ROOT, refreshBagsApiKeyFromEnvFile } from "./loadEnv";
import { supabase } from "./supabaseClient";
import {
  bagsConfigured,
  bagsCreateFeeShareConfig,
  bagsCreateLaunchTransaction,
  bagsCreateTokenInfo,
  bagsGetPoolByMint,
  bagsPingAuth,
  bagsSendTransaction,
  BagsApiError,
  getBagsConfig,
} from "./bagsClient";

const PORT = Number(process.env.PORT) || 3001;
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ── Filter helper ────────────────────────────────────────────
type FeedFilter = "all" | "noTokens" | "highScore";

const isFeedFilter = (v: unknown): v is FeedFilter =>
  v === "all" || v === "noTokens" || v === "highScore";

/** Demo card for Bags tokenize testing — see FEED_INCLUDE_DUMMY in .env */
function buildDummyFeedTweet(): {
  tweet_id: string;
  avatar: string;
  avatarColor: string;
  name: string;
  handle: string;
  time: string;
  tweet: string;
  keywords: string[];
  likes: string;
  retweets: string;
  views: string;
  narrative: string;
  image?: string;
  tokens: {
    rank: number;
    icon: string;
    name: string;
    match: number;
    marketCap: string;
    returns: string;
    score: number;
  }[];
} {
  const narrative =
    "Local demo post — use Tokenize to run a real Bags launch flow (metadata, fee share, Phantom signatures). Swap in live tweets once your feed pipeline is connected.";
  return {
    tweet_id: "demo-feed-preview",
    avatar: "DM",
    avatarColor: "#7dd3a0",
    name: "Demo feed (local)",
    handle: "@demo_feed_preview",
    time: "Preview",
    tweet: narrative,
    keywords: ["Bags", "demo", "launch"],
    likes: "0",
    retweets: "0",
    views: "0",
    narrative,
    tokens: [],
  };
}

function shouldIncludeDummyFeedRow(realRowCount: number): boolean {
  const flag = process.env.FEED_INCLUDE_DUMMY?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  return realRowCount === 0;
}

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const buildAuthMessage = (address: string, nonce: string, issuedAt: string): string =>
  `Sign this message to authenticate with Feed.\n\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;

type BagsState = {
  feeShareTxs?: string[];
  launchTx?: string | null;
};

async function getSessionWalletAddress(req: express.Request): Promise<string | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data: session, error } = await supabase
    .from("wallet_sessions")
    .select("address,expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !session) return null;
  if (Date.now() > new Date(session.expires_at).getTime()) return null;
  return session.address;
}

async function recordBagsSnapshot(params: {
  launchId: string;
  wallet?: string | null;
  tokenMint?: string | null;
  eventType: string;
  raw: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("bags_onchain_snapshots").insert({
    launch_id: params.launchId,
    wallet_address: params.wallet ?? null,
    token_mint: params.tokenMint ?? null,
    event_type: params.eventType,
    raw: params.raw,
  });
  if (error) {
    console.error("bags_onchain_snapshots insert error:", error);
  }
}

const defaultTokenImageUrl = (): string =>
  process.env.BAGS_DEFAULT_TOKEN_IMAGE_URL?.trim() ||
  "https://img.freepik.com/premium-vector/white-abstract-vactor-background-design_665257-153.jpg";

app.post("/api/auth/nonce", (req, res) => {
  const address = String(req.body?.address ?? "").trim();
  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  const nonce = randomUUID().replace(/-/g, "");
  const issuedAt = new Date().toISOString();
  const message = buildAuthMessage(address, nonce, issuedAt);
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
  void supabase
    .from("wallet_nonces")
    .insert({
      nonce,
      address,
      message,
      expires_at: expiresAt,
      used: false,
    })
    .then(({ error }) => {
      if (error) {
        console.error("Nonce insert error:", error);
        res.status(500).json({ error: "failed to issue nonce" });
        return;
      }
      res.json({ nonce, message, expiresAt });
    });
});

app.post("/api/auth/verify", async (req, res) => {
  try {
    const address = String(req.body?.address ?? "").trim();
    const nonce = String(req.body?.nonce ?? "").trim();
    const signatureB64 = String(req.body?.signature ?? "").trim();

    if (!address || !nonce || !signatureB64) {
      res.status(400).json({ error: "address, nonce and signature are required" });
      return;
    }

    const { data: record, error: nonceError } = await supabase
      .from("wallet_nonces")
      .select("nonce,address,message,expires_at,used")
      .eq("nonce", nonce)
      .maybeSingle();

    if (nonceError) {
      console.error("Nonce lookup error:", nonceError);
      res.status(500).json({ error: "failed to verify nonce" });
      return;
    }

    const expiresAtMs = record?.expires_at ? new Date(record.expires_at).getTime() : 0;
    if (!record || record.used || record.address !== address || Date.now() > expiresAtMs) {
      res.status(401).json({ error: "invalid or expired nonce" });
      return;
    }

    const publicKeyBytes = bs58.decode(address);
    const signatureBytes = Buffer.from(signatureB64, "base64");
    const messageBytes = new TextEncoder().encode(record.message);

    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!valid) {
      res.status(401).json({ error: "invalid wallet signature" });
      return;
    }

    await supabase.from("wallet_nonces").update({ used: true }).eq("nonce", nonce);
    const token = randomUUID();
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error: sessionError } = await supabase.from("wallet_sessions").insert({
      token,
      address,
      expires_at: sessionExpiresAt,
    });

    if (sessionError) {
      console.error("Session insert error:", sessionError);
      res.status(500).json({ error: "failed to create wallet session" });
      return;
    }

    res.json({ ok: true, address, token });
  } catch (err) {
    console.error("Wallet verify error:", err);
    res.status(500).json({ error: "wallet verification failed" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    res.status(401).json({ ok: false });
    return;
  }

  const { data: session, error } = await supabase
    .from("wallet_sessions")
    .select("address,expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Session lookup error:", error);
    res.status(500).json({ ok: false });
    return;
  }

  if (!session || Date.now() > new Date(session.expires_at).getTime()) {
    res.status(401).json({ ok: false });
    return;
  }

  res.json({ ok: true, address: session.address });
});

app.post("/api/auth/logout", async (req, res) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) {
    await supabase.from("wallet_sessions").delete().eq("token", token);
  }
  res.json({ ok: true });
});

app.post("/api/auth/cleanup", async (_req, res) => {
  const { error } = await supabase.rpc("cleanup_expired_wallet_auth");
  if (error) {
    console.error("Auth cleanup error:", error);
    res.status(500).json({ ok: false, error: "cleanup failed" });
    return;
  }
  res.json({ ok: true });
});

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "feed-api" });
});

/**
 * Safe diagnostics: does the API process see BAGS_API_KEY, and does Bags accept it?
 * Open in browser: http://localhost:3001/api/health/bags (or same path via Vite proxy on :5173).
 */
app.get("/api/health/bags", async (_req, res) => {
  refreshBagsApiKeyFromEnvFile();
  const cfg = getBagsConfig();
  const ping = await bagsPingAuth();
  res.json({
    projectRoot: ENV_PROJECT_ROOT,
    bagsBaseUrl: cfg.baseUrl,
    bagsKeyLoaded: cfg.apiKey.length > 0,
    bagsKeyLength: cfg.apiKey.length,
    bagsKeyLooksLikeBagsFormat: cfg.apiKey.startsWith("bags_"),
    ping,
    debugLogging:
      "Add LOG_BAGS_HTTP=true to .env and restart the API to print [bags-http] lines for every Bags request.",
  });
});

// ── Feed ─────────────────────────────────────────────────────
app.get("/api/feed", async (req, res) => {
  try {
    const raw = req.query.filter;
    const filter: FeedFilter = isFeedFilter(raw) ? raw : "all";

    const { data, error } = await supabase
      .from("tweets")
      .select(`
        *,
        creators (
          handle,
          display_name,
          avatar_url,
          follower_count,
          score
        ),
        narrative_tokens (
          id,
          token_name,
          token_ticker,
          token_mint,
          current_mcap,
          total_volume,
          launched_at,
          launched_here
        )
      `)
      .order("posted_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase feed error:", error);
      res.status(500).json({ error: "Failed to fetch feed" });
      return;
    }

    const rows = (data ?? []) as any[];
    const normalized = rows.map((row) => {
      const creator = row.creators ?? {};
      const tokens = Array.isArray(row.narrative_tokens) ? row.narrative_tokens : [];
      return {
        tweet_id: row.tweet_id ?? row.id ?? null,
        avatar: String((creator.display_name ?? creator.handle ?? "NA")).slice(0, 2).toUpperCase(),
        avatarColor: "#B5D4F4",
        name: creator.display_name ?? creator.handle ?? "Unknown",
        handle: creator.handle ? `@${String(creator.handle).replace(/^@/, "")}` : "@unknown",
        time: "now",
        tweet: row.content ?? "",
        keywords: [] as string[],
        likes: String(row.likes ?? 0),
        retweets: String(row.retweets ?? 0),
        views: String(row.views ?? 0),
        narrative: row.content ?? "",
        image: row.image_url ?? undefined,
        tokens: tokens.map((t: any, i: number) => ({
          rank: i + 1,
          icon: String(t.token_ticker ?? "TK").slice(0, 2).toUpperCase(),
          name: t.token_name ?? "UNKNOWN",
          match: Number(t.match_score ?? 80),
          marketCap: t.current_mcap ? `$${t.current_mcap}` : "$0",
          returns: String(t.returns ?? "0%"),
          score: Number(t.score ?? 50),
        })),
      };
    });

    let merged = normalized;
    if (shouldIncludeDummyFeedRow(normalized.length)) {
      merged = [buildDummyFeedTweet(), ...normalized];
    }

    const tweets = merged.filter((t) => {
      if (filter === "noTokens") return t.tokens.length === 0;
      if (filter === "highScore") return t.tokens.some((x) => x.score >= 70);
      return true;
    });

    res.json({ tweets, filter });
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Launches (Bags + Supabase) ───────────────────────────────
app.post("/api/launches", async (req, res) => {
  try {
    refreshBagsApiKeyFromEnvFile();

    const { tweet_id, name, ticker, liquiditySol, narrative, wallet, imageUrl } = req.body as Record<
      string,
      unknown
    >;

    const nameTrim = String(name ?? "").trim();
    const tickerTrim = String(ticker ?? "").trim();
    if (!nameTrim || !tickerTrim) {
      res.status(400).json({ error: "name and ticker are required" });
      return;
    }

    const launchId = randomUUID();
    const sol = Number(liquiditySol);
    const initialBuyLamports =
      Number.isFinite(sol) && sol > 0 ? Math.min(Math.floor(sol * 1e9), Number.MAX_SAFE_INTEGER) : 0;

    const sessionWallet = await getSessionWalletAddress(req);
    const walletAddr = String(wallet ?? "").trim();

    if (sessionWallet && walletAddr && sessionWallet !== walletAddr) {
      res.status(401).json({ error: "wallet does not match signed-in session" });
      return;
    }

    const record: Record<string, unknown> = {
      id: launchId,
      tweet_id: tweet_id ?? null,
      token_name: nameTrim,
      token_ticker: tickerTrim.toUpperCase(),
      status: "pending",
      created_at: new Date().toISOString(),
      narrative: String(narrative ?? "").slice(0, 2000) || null,
      wallet_address: walletAddr || null,
      initial_buy_lamports: initialBuyLamports,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("launches")
      .insert(record)
      .select()
      .single();

    if (insertError) {
      console.error("Launch insert error:", insertError);
      const { data: fallback, error: fallbackErr } = await supabase
        .from("launches")
        .insert({
          id: launchId,
          tweet_id: tweet_id ?? null,
          token_name: nameTrim,
          token_ticker: tickerTrim.toUpperCase(),
          status: "pending",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (fallbackErr) {
        res.status(500).json({ error: "Failed to save launch (run supabase-bags-onchain.sql if columns missing)" });
        return;
      }
      if (!bagsConfigured()) {
        res.status(201).json({
          launch: fallback,
          bags: null,
          message:
            "Launch saved without Bags columns. Apply supabase-bags-onchain.sql and set BAGS_API_KEY for on-chain launch.",
        });
        return;
      }
      res.status(500).json({
        error:
          "Launches table missing Bags columns. Run supabase-bags-onchain.sql, then retry with wallet + BAGS_API_KEY.",
      });
      return;
    }

    if (!bagsConfigured()) {
      await recordBagsSnapshot({
        launchId,
        wallet: walletAddr || null,
        eventType: "bags_disabled",
        raw: { note: "BAGS_API_KEY not set" },
      });
      res.status(201).json({
        launch: inserted,
        bags: null,
        message: "Launch recorded. Add BAGS_API_KEY to your existing .env (same file as Supabase) to enable Bags.",
      });
      return;
    }

    if (!walletAddr) {
      res.status(400).json({ error: "wallet is required when BAGS_API_KEY is set (connect Phantom first)" });
      return;
    }

    const image = String(imageUrl ?? "").trim() || defaultTokenImageUrl();

    let tokenMint: string;
    let tokenMetadata: string;
    let tokenLaunch: Record<string, unknown>;

    try {
      console.log(`[launch] ${launchId} → calling Bags create-token-info`);
      const info = await bagsCreateTokenInfo({
        name: nameTrim,
        symbol: tickerTrim,
        description: String(narrative ?? "").slice(0, 1000) || `${nameTrim} (${tickerTrim})`,
        imageUrl: image,
      });
      tokenMint = info.response.tokenMint;
      tokenMetadata = info.response.tokenMetadata;
      tokenLaunch = info.response.tokenLaunch as Record<string, unknown>;
    } catch (e) {
      console.error("Bags create-token-info error:", e);
      await supabase.from("launches").update({ status: "failed" }).eq("id", launchId);
      const msg = e instanceof BagsApiError ? e.message : "Bags create-token-info failed";
      res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
        error: msg,
        launch: inserted,
      });
      return;
    }

    await recordBagsSnapshot({
      launchId,
      wallet: walletAddr,
      tokenMint,
      eventType: "token_info_created",
      raw: { tokenMint, tokenMetadata, tokenLaunch },
    });

    let feeRes;
    try {
      feeRes = await bagsCreateFeeShareConfig({
        payer: walletAddr,
        baseMint: tokenMint,
        claimersArray: [walletAddr],
        basisPointsArray: [10000],
      });
    } catch (e) {
      console.error("Bags fee-share config error:", e);
      await supabase.from("launches").update({ status: "failed", token_mint: tokenMint, metadata_uri: tokenMetadata }).eq("id", launchId);
      const msg = e instanceof BagsApiError ? e.message : "Bags fee-share config failed";
      res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
        error: msg,
        launch: { ...inserted, token_mint: tokenMint, metadata_uri: tokenMetadata },
      });
      return;
    }

    const fr = feeRes.response;
    await recordBagsSnapshot({
      launchId,
      wallet: walletAddr,
      tokenMint,
      eventType: "fee_share_config_response",
      raw: fr as unknown as Record<string, unknown>,
    });

    if (fr.bundles && fr.bundles.length > 0) {
      await supabase
        .from("launches")
        .update({
          status: "failed",
          token_mint: tokenMint,
          metadata_uri: tokenMetadata,
          meteora_config_key: fr.meteoraConfigKey,
        })
        .eq("id", launchId);
      res.status(501).json({
        error:
          "Bags returned a Jito bundle for fee-share setup; this app currently supports linear transactions only. Try fewer fee claimers or use the Bags SDK.",
        launchId,
      });
      return;
    }

    const txStrings = (fr.transactions ?? []).map((t) => t.transaction);
    const bagsState: BagsState = {};
    let nextTransaction: string | null = null;
    let status: string;
    let phase: "fee_share" | "launch";

    if (fr.needsCreation && txStrings.length > 0) {
      bagsState.feeShareTxs = [...txStrings];
      nextTransaction = txStrings[0] ?? null;
      status = "awaiting_fee_share";
      phase = "fee_share";
    } else {
      let lt;
      try {
        lt = await bagsCreateLaunchTransaction({
          ipfs: tokenMetadata,
          tokenMint,
          wallet: walletAddr,
          initialBuyLamports,
          configKey: fr.meteoraConfigKey,
        });
      } catch (e) {
        console.error("Bags create-launch-tx error:", e);
        await supabase
          .from("launches")
          .update({
            status: "failed",
            token_mint: tokenMint,
            metadata_uri: tokenMetadata,
            meteora_config_key: fr.meteoraConfigKey,
          })
          .eq("id", launchId);
        const msg = e instanceof BagsApiError ? e.message : "Bags create-launch-transaction failed";
        res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
          error: msg,
        });
        return;
      }
      bagsState.launchTx = lt.response;
      nextTransaction = lt.response;
      status = "awaiting_launch_signature";
      phase = "launch";
      await recordBagsSnapshot({
        launchId,
        wallet: walletAddr,
        tokenMint,
        eventType: "launch_tx_created",
        raw: { initialBuyLamports, configKey: fr.meteoraConfigKey },
      });
    }

    const { data: updated, error: upErr } = await supabase
      .from("launches")
      .update({
        token_mint: tokenMint,
        metadata_uri: tokenMetadata,
        meteora_config_key: fr.meteoraConfigKey,
        bags_state: bagsState,
        status,
      })
      .eq("id", launchId)
      .select()
      .single();

    if (upErr) {
      console.error("Launch update error:", upErr);
    }

    res.status(201).json({
      launch: updated ?? { ...inserted, token_mint: tokenMint, metadata_uri: tokenMetadata, status },
      bags: {
        phase,
        nextTransaction,
        mintUrl: `https://bags.fm/${tokenMint}`,
      },
    });
  } catch (err) {
    console.error("Launch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/launches/:launchId/submit-tx", async (req, res) => {
  try {
    refreshBagsApiKeyFromEnvFile();
    if (!bagsConfigured()) {
      res.status(503).json({ error: "BAGS_API_KEY is not configured" });
      return;
    }

    const launchId = req.params.launchId;
    const signedTransaction = String(req.body?.signedTransaction ?? "").trim();
    if (!signedTransaction) {
      res.status(400).json({ error: "signedTransaction is required" });
      return;
    }

    const sessionWallet = await getSessionWalletAddress(req);
    const { data: launch, error } = await supabase.from("launches").select("*").eq("id", launchId).maybeSingle();

    if (error || !launch) {
      res.status(404).json({ error: "launch not found" });
      return;
    }

    const rowWallet = launch.wallet_address as string | null;
    if (sessionWallet && rowWallet && sessionWallet !== rowWallet) {
      res.status(401).json({ error: "session wallet does not match launch wallet" });
      return;
    }

    const bagsState = (launch.bags_state ?? {}) as BagsState;
    const tokenMint = launch.token_mint as string;
    const metadataUri = launch.metadata_uri as string;
    const walletAddr = launch.wallet_address as string;
    const initialBuyLamports = Number(launch.initial_buy_lamports ?? 0);
    const configKey = launch.meteora_config_key as string;

    const feeList = bagsState.feeShareTxs;

    if (Array.isArray(feeList) && feeList.length > 0) {
      let sig: string;
      try {
        const sent = await bagsSendTransaction(signedTransaction);
        sig = sent.response;
      } catch (e) {
        const msg = e instanceof BagsApiError ? e.message : "Failed to submit transaction to Bags";
        res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
          error: msg,
        });
        return;
      }

      await recordBagsSnapshot({
        launchId,
        wallet: walletAddr,
        tokenMint,
        eventType: "fee_share_tx_submitted",
        raw: { signature: sig, remainingBeforePop: feeList.length },
      });

      const remaining = feeList.slice(1);
      const nextState: BagsState = { ...bagsState, feeShareTxs: remaining };

      if (remaining.length > 0) {
        await supabase.from("launches").update({ bags_state: nextState }).eq("id", launchId);
        res.json({
          ok: true,
          phase: "fee_share" as const,
          signature: sig,
          nextTransaction: remaining[0] ?? null,
        });
        return;
      }

      delete nextState.feeShareTxs;
      let lt;
      try {
        lt = await bagsCreateLaunchTransaction({
          ipfs: metadataUri,
          tokenMint,
          wallet: walletAddr,
          initialBuyLamports,
          configKey,
        });
      } catch (e) {
        console.error("Bags create-launch-tx (after fee) error:", e);
        await supabase.from("launches").update({ bags_state: nextState, status: "failed" }).eq("id", launchId);
        const msg = e instanceof BagsApiError ? e.message : "Bags create-launch-transaction failed";
        res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
          error: msg,
          signature: sig,
        });
        return;
      }

      nextState.launchTx = lt.response;
      await supabase
        .from("launches")
        .update({
          bags_state: nextState,
          status: "awaiting_launch_signature",
        })
        .eq("id", launchId);

      await recordBagsSnapshot({
        launchId,
        wallet: walletAddr,
        tokenMint,
        eventType: "launch_tx_created",
        raw: { afterFeeShare: true },
      });

      res.json({
        ok: true,
        phase: "launch" as const,
        signature: sig,
        nextTransaction: lt.response,
      });
      return;
    }

    if (bagsState.launchTx) {
      let sig: string;
      try {
        const sent = await bagsSendTransaction(signedTransaction);
        sig = sent.response;
      } catch (e) {
        const msg = e instanceof BagsApiError ? e.message : "Failed to submit launch transaction";
        res.status(e instanceof BagsApiError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 502).json({
          error: msg,
        });
        return;
      }

      let pool: unknown = null;
      try {
        pool = await bagsGetPoolByMint(tokenMint);
      } catch (poolErr) {
        pool = { fetchError: poolErr instanceof Error ? poolErr.message : String(poolErr) };
      }

      await recordBagsSnapshot({
        launchId,
        wallet: walletAddr,
        tokenMint,
        eventType: "post_launch_pool_snapshot",
        raw: { signature: sig, pool },
      });

      await supabase
        .from("launches")
        .update({
          status: "launched",
          bags_state: {},
          launch_signature: sig,
        })
        .eq("id", launchId);

      res.json({
        ok: true,
        phase: "done" as const,
        signature: sig,
        nextTransaction: null,
        pool,
        mintUrl: `https://bags.fm/${tokenMint}`,
      });
      return;
    }

    res.status(400).json({ error: "No pending Bags transaction for this launch" });
  } catch (err) {
    console.error("submit-tx error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Creators ─────────────────────────────────────────────────
app.get("/api/creators", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("creators")
      .select("*")
      .order("score", { ascending: false });

    if (error) {
      console.error("Creators error:", error);
      res.status(500).json({ error: "Failed to fetch creators" });
      return;
    }

    res.json({ creators: data ?? [] });
  } catch (err) {
    console.error("Creators error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Webhook (Apify → new tweets) ─────────────────────────────
app.post("/api/webhooks/apify", async (req, res) => {
  try {
    const items = req.body?.items ?? req.body ?? [];
    const tweets = Array.isArray(items) ? items : [items];

    for (const tweet of tweets) {
      const handle = tweet?.author?.userName?.toLowerCase();
      if (!handle) continue;

      // Only process tracked creators
      const { data: creator } = await supabase
        .from("creators")
        .select("handle")
        .eq("handle", handle)
        .single();

      if (!creator) continue;

      // Upsert tweet — won't duplicate if already exists
      const { error } = await supabase.from("tweets").upsert(
        {
          tweet_id: tweet.id,
          creator_handle: creator.handle,
          content: tweet.text ?? tweet.fullText ?? "",
          likes: tweet.likeCount ?? 0,
          retweets: tweet.retweetCount ?? 0,
          replies: tweet.replyCount ?? 0,
          posted_at: tweet.createdAt ?? new Date().toISOString(),
        },
        { onConflict: "tweet_id" }
      );

      if (error) console.error("Tweet upsert error:", error);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`[feed-api] Loaded .env from project root: ${ENV_PROJECT_ROOT}`);
  console.log(
    `[feed-api] BAGS_API_KEY: ${bagsConfigured() ? "loaded" : "MISSING — use exact name BAGS_API_KEY in .env at project root, then restart this server"}`
  );
});