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

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TRACKED_HANDLES = [
  "0xnecokizz",
  "vitalikbuterin",
  "cz_binance",
  "arthurcrypto",
  "zachxbt",
  "blknoiz06",
  "muststopmurad",
  "realdonaldtrump",
  "a1lon9",
  "elonmusk",
];

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

function toRelativeTime(isoLike: unknown): string {
  const ts = typeof isoLike === "string" ? Date.parse(isoLike) : NaN;
  if (!Number.isFinite(ts)) return "now";
  const diffMs = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

type NormalizedIncomingTweet = {
  id: string;
  handle: string;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  postedAt: string;
  kind: "tweet" | "repost" | "quote" | "comment";
};

function normalizeTwitterapiTweet(rawTweet: unknown): NormalizedIncomingTweet | null {
  const t = (rawTweet ?? {}) as Record<string, unknown>;
  const author = (t.author ?? {}) as Record<string, unknown>;
  const handleRaw =
    author.username ??
    author.userName ??
    t.user_name ??
    t.username ??
    t.screen_name;
  const handle = String(handleRaw ?? "").replace(/^@/, "").toLowerCase().trim();
  const id = String(t.id ?? t.tweet_id ?? "").trim();
  if (!handle || !id) return null;

  const referenced = Array.isArray(t.referenced_tweets)
    ? (t.referenced_tweets as Array<Record<string, unknown>>)
    : [];
  const hasRef = (refType: string): boolean =>
    referenced.some((r) => String(r?.type ?? "").toLowerCase() === refType);

  const isRepost =
    Boolean(t.is_retweet) ||
    Boolean(t.retweeted_tweet_id) ||
    hasRef("retweeted") ||
    Boolean(t.retweeted_tweet);
  const isQuote = Boolean(t.is_quote) || Boolean(t.quote_tweet_id) || hasRef("quoted") || Boolean(t.quoted_tweet);
  const isComment =
    Boolean(t.in_reply_to_status_id) ||
    Boolean(t.in_reply_to_tweet_id) ||
    hasRef("replied_to") ||
    Boolean(t.is_reply);

  const kind: NormalizedIncomingTweet["kind"] = isRepost ? "repost" : isQuote ? "quote" : isComment ? "comment" : "tweet";
  const baseText = String(t.text ?? t.full_text ?? t.note_tweet_text ?? "").trim();
  const content = (kind === "tweet" ? baseText : `[${kind}] ${baseText}`).trim();

  return {
    id,
    handle,
    content,
    likes: Number(t.like_count ?? t.favorite_count ?? t.likes ?? 0),
    retweets: Number(t.retweet_count ?? t.retweets ?? 0),
    replies: Number(t.reply_count ?? t.replies ?? 0),
    postedAt: String(t.created_at ?? t.createdAt ?? new Date().toISOString()),
    kind,
  };
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

/**
 * Map a Bags error to actionable advice. Bags' error text is often generic
 * ("Internal server error"), so we also use the endpoint + step context
 * to surface the most likely cause.
 */
function interpretBagsError(
  err: unknown,
  step: "token_info" | "fee_share_config" | "fee_share_submit" | "launch_tx" | "launch_submit",
): { message: string; status: number; hint: string } {
  const status = err instanceof BagsApiError ? err.status : 502;
  const raw = err instanceof BagsApiError ? err.message : err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  let hint = "";
  if (/insufficient/.test(lower) || /not enough sol/.test(lower) || /lamports/.test(lower)) {
    hint =
      "Wallet has insufficient SOL. Fund the wallet with enough SOL to cover the initial buy + fees (typically initialBuy + ~0.01 SOL).";
  } else if (/invalid api key|unauthor/.test(lower) || status === 401 || status === 403) {
    hint = "BAGS_API_KEY rejected. Generate a new key at dev.bags.fm and update your .env.";
  } else if (/rate limit|429/.test(lower) || status === 429) {
    hint = "Rate limited (>1000 req/hour). Wait a minute and retry.";
  } else if (/name|symbol|description|image/i.test(raw) && status === 400) {
    hint =
      "Validation: name max 32 chars, symbol max 10 chars, description max 1000 chars, image must be public URL or <15MB upload.";
  } else if (/bps|basis/.test(lower)) {
    hint = "BPS rule: claimers must sum to exactly 10000 (= 100%).";
  } else if (status >= 500 && status < 600) {
    if (step === "launch_tx") {
      hint =
        "Most common cause for 500 here: insufficient SOL in the launching wallet (initial buy + tx fees), or Bags couldn't see the just-confirmed fee-share config yet — wait ~5s and retry.";
    } else if (step === "launch_submit" || step === "fee_share_submit") {
      hint =
        "On-chain submission failed. Likely the signed transaction expired (blockhash too old), or a duplicate. Retry the launch fresh.";
    } else if (step === "fee_share_config") {
      hint = "Fee share config rejected. Check claimers/BPS sum to 10000 and the wallet exists.";
    } else if (step === "token_info") {
      hint =
        "Token metadata creation failed. Check imageUrl is a public, fast-loading image (try a small PNG <2MB) and name/symbol/description lengths.";
    } else {
      hint = "Bags-side server error. Retry in a moment; if persistent, check your wallet has SOL and the API key is valid.";
    }
  }

  return { message: raw, status: status >= 400 && status < 600 ? status : 502, hint };
}

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
      const lowerContent = String(row.content ?? "").toLowerCase();
      const typeKeyword =
        lowerContent.startsWith("[repost]")
          ? "repost"
          : lowerContent.startsWith("[quote]")
            ? "quote"
            : lowerContent.startsWith("[comment]")
              ? "comment"
              : "tweet";
      return {
        tweet_id: row.tweet_id ?? row.id ?? null,
        avatar: String((creator.display_name ?? creator.handle ?? "NA")).slice(0, 2).toUpperCase(),
        avatarColor: "#B5D4F4",
        name: creator.display_name ?? creator.handle ?? "Unknown",
        handle: creator.handle ? `@${String(creator.handle).replace(/^@/, "")}` : "@unknown",
        time: toRelativeTime(row.posted_at),
        tweet: row.content ?? "",
        keywords: [typeKeyword],
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

    const tweets = normalized.filter((t) => {
      if (filter === "noTokens") return t.tokens.length === 0;
      if (filter === "highScore") return t.tokens.some((x: { score: number }) => x.score >= 70);
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
      const i = interpretBagsError(e, "token_info");
      res.status(i.status).json({ error: i.message, hint: i.hint, step: "token_info", launch: inserted });
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
      const i = interpretBagsError(e, "fee_share_config");
      res.status(i.status).json({
        error: i.message,
        hint: i.hint,
        step: "fee_share_config",
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
        const i = interpretBagsError(e, "launch_tx");
        res.status(i.status).json({ error: i.message, hint: i.hint, step: "launch_tx" });
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
        const i = interpretBagsError(e, "fee_share_submit");
        res.status(i.status).json({ error: i.message, hint: i.hint, step: "fee_share_submit" });
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
        const i = interpretBagsError(e, "launch_tx");
        res.status(i.status).json({ error: i.message, hint: i.hint, step: "launch_tx", signature: sig });
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
        const i = interpretBagsError(e, "launch_submit");
        res.status(i.status).json({ error: i.message, hint: i.hint, step: "launch_submit" });
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

// ── twitterapi.io monitor sync (tracks configured handles) ───
app.post("/api/admin/twitterapi/sync-monitors", async (_req, res) => {
  try {
    const apiKey = process.env.TWITTERAPI_IO_KEY?.trim();
    if (!apiKey) {
      res.status(400).json({ error: "TWITTERAPI_IO_KEY missing in .env" });
      return;
    }

    const envHandles = (process.env.TWITTER_TRACKED_HANDLES ?? "")
      .split(",")
      .map((h) => h.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean);

    let handles = envHandles;
    if (handles.length === 0) {
      const { data: creators, error } = await supabase
        .from("creators")
        .select("handle")
        .not("handle", "is", null)
        .limit(200);
      if (error) {
        console.error("sync-monitors creators lookup error:", error);
        res.status(500).json({ error: "Failed to load creators" });
        return;
      }
      handles = (creators ?? [])
        .map((c: { handle?: string | null }) => String(c.handle ?? "").replace(/^@/, "").toLowerCase().trim())
        .filter(Boolean);
    }
    if (handles.length === 0) handles = DEFAULT_TRACKED_HANDLES;

    const uniqueHandles = [...new Set(handles)];
    const added: string[] = [];
    const failed: Array<{ handle: string; status: number; body: string }> = [];

    for (const handle of uniqueHandles) {
      const r = await fetch("https://api.twitterapi.io/oapi/x_user_stream/add_user_to_monitor_tweet", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ x_user_name: handle }),
      });
      if (!r.ok) {
        failed.push({
          handle,
          status: r.status,
          body: await r.text().catch(() => ""),
        });
        continue;
      }
      added.push(handle);
    }

    res.json({
      success: true,
      requested: uniqueHandles.length,
      added,
      failed,
      note: "Tweets/reposts/quotes/replies from monitored users will be pushed to /api/webhooks/twitterapi when webhook is configured in twitterapi.io dashboard.",
    });
  } catch (err) {
    console.error("sync-monitors error:", err);
    res.status(500).json({ error: "Monitor sync failed" });
  }
});

// ── Webhook (Apify → new tweets) ─────────────────────────────
/**
 * Pull tweets out of an Apify webhook body.
 * Apify's default webhook body looks like:
 *   { eventType, resource: { defaultDatasetId, ... }, ... }
 * We also accept inline `items` arrays for tests/curl.
 */
async function extractApifyTweets(body: unknown): Promise<unknown[]> {
  if (Array.isArray(body)) return body;
  const b = body as { items?: unknown[]; resource?: { defaultDatasetId?: string } };
  if (Array.isArray(b?.items)) return b.items;
  const datasetId = b?.resource?.defaultDatasetId;
  if (datasetId) {
    const apifyToken = process.env.APIFY_TOKEN?.trim();
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json${
      apifyToken ? `&token=${encodeURIComponent(apifyToken)}` : ""
    }`;
    console.log(`[apify-webhook] fetching dataset ${datasetId}`);
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`[apify-webhook] dataset fetch failed: ${r.status} ${await r.text().catch(() => "")}`);
      return [];
    }
    const data = (await r.json()) as unknown[];
    return Array.isArray(data) ? data : [];
  }
  return [];
}

app.post("/api/webhooks/apify", async (req, res) => {
  try {
    const tweets = await extractApifyTweets(req.body);
    console.log(`[apify-webhook] received ${tweets.length} tweet(s)`);

    let inserted = 0;
    let skipped = 0;
    for (const tweet of tweets as Array<Record<string, unknown> & { author?: { userName?: string } }>) {
      const handle = tweet?.author?.userName?.toLowerCase();
      if (!handle) continue;

      // Only process tracked creators
      const { data: creator } = await supabase
        .from("creators")
        .select("handle")
        .eq("handle", handle)
        .single();

      if (!creator) {
        skipped++;
        continue;
      }

      const t = tweet as Record<string, unknown>;
      const { error } = await supabase.from("tweets").upsert(
        {
          tweet_id: String(t.id ?? ""),
          creator_handle: creator.handle,
          content: String(t.text ?? t.fullText ?? ""),
          likes: Number(t.likeCount ?? 0),
          retweets: Number(t.retweetCount ?? 0),
          replies: Number(t.replyCount ?? 0),
          posted_at: String(t.createdAt ?? new Date().toISOString()),
        },
        { onConflict: "tweet_id" },
      );

      if (error) {
        console.error("Tweet upsert error:", error);
      } else {
        inserted++;
      }
    }

    console.log(`[apify-webhook] inserted=${inserted} skipped=${skipped}`);
    res.json({ success: true, inserted, skipped, total: tweets.length });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ── Webhook (twitterapi.io → real-time tweets) ───────────────
/**
 * twitterapi.io pushes a payload like:
 *   {
 *     event_type: "tweet",
 *     rule_id: "...",
 *     rule_tag: "...",
 *     tweets: [{ id, text, author: { username, ... }, created_at, like_count, retweet_count, reply_count }],
 *     timestamp: 1642789123456
 *   }
 * It also includes an `X-API-Key` header equal to your account API key.
 * Set TWITTERAPI_WEBHOOK_KEY in .env to enable verification.
 */
app.post("/api/webhooks/twitterapi", async (req, res) => {
  try {
    const expectedKey = process.env.TWITTERAPI_WEBHOOK_KEY?.trim();
    const receivedKey = (req.header("x-api-key") || req.header("X-API-Key") || "").trim();
    if (expectedKey && receivedKey !== expectedKey) {
      console.warn("[twitterapi-webhook] rejected: bad/missing X-API-Key");
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const body = req.body as {
      event_type?: string;
      tweet?: unknown;
      tweets?: Array<{
        id?: string;
        text?: string;
        author?: { username?: string };
        created_at?: string;
        like_count?: number;
        retweet_count?: number;
        reply_count?: number;
      }>;
    };
    const rawTweets = Array.isArray(body?.tweets)
      ? body.tweets
      : body?.tweet
        ? [body.tweet]
        : [];
    const tweets = rawTweets.map((t) => normalizeTwitterapiTweet(t)).filter((t): t is NormalizedIncomingTweet => !!t);
    console.log(`[twitterapi-webhook] received ${tweets.length} tweet(s) (event=${body?.event_type ?? "?"})`);

    let inserted = 0;
    let skipped = 0;
    for (const tweet of tweets) {
      const { data: creator } = await supabase
        .from("creators")
        .select("handle")
        .eq("handle", tweet.handle)
        .single();

      if (!creator) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from("tweets").upsert(
        {
          tweet_id: tweet.id,
          creator_handle: creator.handle,
          content: tweet.content,
          likes: tweet.likes,
          retweets: tweet.retweets,
          replies: tweet.replies,
          posted_at: tweet.postedAt,
        },
        { onConflict: "tweet_id" },
      );

      if (error) {
        console.error("Tweet upsert error:", error);
      } else {
        inserted++;
      }
    }

    console.log(`[twitterapi-webhook] inserted=${inserted} skipped=${skipped}`);
    res.json({ success: true, inserted, skipped, total: tweets.length });
  } catch (err) {
    console.error("twitterapi webhook error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ── Live metrics refresher ───────────────────────────────────
/**
 * Webhooks deliver a *snapshot* of likes/retweets/replies at the moment a tweet
 * was first detected — the values never auto-update. This periodic job calls
 * twitterapi.io's GET /twitter/tweets?tweet_ids=... endpoint to refresh metrics
 * for the most recent N tweets (younger than ~24h).
 *
 * Cost-aware defaults:
 *   - METRICS_REFRESH_LIMIT (default 20)   — how many recent tweets to refresh
 *   - METRICS_REFRESH_INTERVAL_MS (default 5 min)
 *   - METRICS_REFRESH_MAX_AGE_HOURS (default 24)
 */
async function refreshTweetMetricsOnce(): Promise<void> {
  const apiKey = process.env.TWITTERAPI_IO_KEY?.trim();
  if (!apiKey) return;

  const limit = Number(process.env.METRICS_REFRESH_LIMIT ?? 20);
  const maxAgeHours = Number(process.env.METRICS_REFRESH_MAX_AGE_HOURS ?? 24);
  const sinceIso = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("tweets")
    .select("tweet_id")
    .gte("posted_at", sinceIso)
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[metrics-refresh] supabase select error:", error);
    return;
  }
  const ids = (rows ?? [])
    .map((r: { tweet_id?: string | null }) => String(r.tweet_id ?? "").trim())
    .filter(Boolean);
  if (ids.length === 0) return;

  try {
    const url = `https://api.twitterapi.io/twitter/tweets?tweet_ids=${encodeURIComponent(ids.join(","))}`;
    const r = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!r.ok) {
      console.warn(`[metrics-refresh] api ${r.status}: ${await r.text().catch(() => "")}`);
      return;
    }
    const body = (await r.json()) as { tweets?: Array<Record<string, unknown>>; data?: Record<string, unknown> };
    const list: Array<Record<string, unknown>> = Array.isArray(body?.tweets)
      ? body.tweets
      : Array.isArray((body?.data as { tweets?: unknown[] })?.tweets)
        ? ((body.data as { tweets: Array<Record<string, unknown>> }).tweets)
        : [];

    if (list.length > 0 && process.env.METRICS_REFRESH_DEBUG === "1") {
      console.log("[metrics-refresh] sample tweet keys:", Object.keys(list[0]).join(","));
    }

    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    let updated = 0;
    for (const t of list) {
      const id = String(t.id ?? t.tweet_id ?? "").trim();
      if (!id) continue;
      const likes = num(t.likeCount ?? t.like_count ?? t.favorite_count ?? t.likes);
      const retweets = num(t.retweetCount ?? t.retweet_count ?? t.retweets);
      const replies = num(t.replyCount ?? t.reply_count ?? t.replies);
      const views = num(
        (t as { viewCount?: number; view_count?: number; views?: number }).viewCount ??
          (t as { view_count?: number }).view_count ??
          (t as { views?: number }).views,
      );

      const { error: upErr } = await supabase
        .from("tweets")
        .update({ likes, retweets, replies, views })
        .eq("tweet_id", id);
      if (upErr) {
        console.warn(`[metrics-refresh] update fail id=${id}:`, upErr.message);
      } else {
        updated++;
      }
    }
    console.log(`[metrics-refresh] refreshed=${updated}/${ids.length}`);
  } catch (err) {
    console.error("[metrics-refresh] error:", err);
  }
}

function startMetricsRefresher(): void {
  if (!process.env.TWITTERAPI_IO_KEY?.trim()) {
    console.log("[metrics-refresh] disabled (TWITTERAPI_IO_KEY missing)");
    return;
  }
  const intervalMs = Number(process.env.METRICS_REFRESH_INTERVAL_MS ?? 5 * 60 * 1000);
  console.log(`[metrics-refresh] enabled, interval=${Math.round(intervalMs / 1000)}s`);
  // First run after short delay so server finishes startup logs.
  setTimeout(() => {
    void refreshTweetMetricsOnce();
    setInterval(() => void refreshTweetMetricsOnce(), intervalMs);
  }, 15_000);
}

// Manual trigger for testing
app.post("/api/admin/twitterapi/refresh-metrics", async (_req, res) => {
  await refreshTweetMetricsOnce();
  res.json({ ok: true });
});

// ── Tweet retention cleanup ──────────────────────────────────
/**
 * Deletes tweets older than TWEET_RETENTION_DAYS (default 30).
 * Runs once a day. Keeps the `tweets` table small and feed queries fast.
 */
async function cleanupOldTweetsOnce(): Promise<void> {
  const days = Number(process.env.TWEET_RETENTION_DAYS ?? 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { error, count } = await supabase
    .from("tweets")
    .delete({ count: "exact" })
    .lt("posted_at", cutoff);
  if (error) {
    console.error("[tweet-cleanup] error:", error.message);
    return;
  }
  console.log(`[tweet-cleanup] deleted ${count ?? 0} tweets older than ${days}d`);
}

function startCleanupJob(): void {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    void cleanupOldTweetsOnce();
    setInterval(() => void cleanupOldTweetsOnce(), ONE_DAY);
  }, 60_000);
}

app.post("/api/admin/cleanup-tweets", async (_req, res) => {
  await cleanupOldTweetsOnce();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`[feed-api] Loaded .env from project root: ${ENV_PROJECT_ROOT}`);
  console.log(
    `[feed-api] BAGS_API_KEY: ${bagsConfigured() ? "loaded" : "MISSING — use exact name BAGS_API_KEY in .env at project root, then restart this server"}`
  );
  startMetricsRefresher();
  startCleanupJob();
});