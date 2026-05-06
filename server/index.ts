import "./loadEnv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimitLib from "express-rate-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import { calculateScratchScore, getConcentrationData } from "./scoring";
import { fetchLinkPreview } from "./linkPreview";
import { runNarrativePipeline, startFeedCacheRefresher } from "./narrativePipeline";

const PORT = Number(process.env.PORT) || 3001;
const app = express();

// ── CORS allowlist ───────────────────────────────────────────
// Set CORS_ORIGINS in .env as a comma-separated list (e.g. "https://bagsapp.vercel.app,http://localhost:5173").
// If unset, allows all origins (dev convenience). In production, always set this.
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: CORS_ORIGINS.length === 0 ? true : CORS_ORIGINS,
    credentials: false,
  }),
);

// Cap JSON body at 256kb to prevent OOM from malicious payloads.
app.use(express.json({ limit: "256kb" }));

// ── Security headers (helmet) ────────────────────────────────
// Disable contentSecurityPolicy by default since this server is API-only;
// enable + tune it once you have a stable list of frontend asset origins.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Trust the first proxy hop (Railway terminates TLS in front of us).
// Required for express-rate-limit to read req.ip correctly.
app.set("trust proxy", 1);

// ── Rate limits per route family ─────────────────────────────
// Auth is the most abuse-prone; keep it tight. Launches are expensive.
// Feed is read-only but can be scraped; moderate. Admin is internal; tight.
const makeLimiter = (windowMs: number, max: number) =>
  rateLimitLib({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited" },
  });

app.use("/api/auth", makeLimiter(60_000, 20));
app.use("/api/launches", makeLimiter(60_000, 10));
app.use("/api/feed", makeLimiter(60_000, 60));
app.use("/api/admin", makeLimiter(60_000, 10));
// Webhook has its own key check; no rate limit to avoid dropping legitimate bursts.

// Constant-time string compare (prevents timing attacks on webhook key).
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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
  imageUrl: string | null;
  likes: number;
  retweets: number;
  replies: number;
  postedAt: string;
  kind: "tweet" | "repost" | "quote" | "comment";
};

const COMMENT_MENTION_PREFIX_RE = /^@[a-z0-9_]{1,15}\b/i;

function startsWithCommentTag(text: string): boolean {
  const trimmed = text.trim();
  return COMMENT_MENTION_PREFIX_RE.test(trimmed);
}

function extractTweetImageUrl(rawTweet: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  const pushMediaUrls = (mediaList: unknown): void => {
    if (!Array.isArray(mediaList)) return;
    for (const item of mediaList) {
      const media = item as Record<string, unknown>;
      const videoInfo = media.video_info as Record<string, unknown> | undefined;
      const variants = Array.isArray(videoInfo?.variants) ? (videoInfo?.variants as unknown[]) : [];
      for (const variant of variants) {
        const v = variant as Record<string, unknown>;
        const vUrl = String(v.url ?? "").trim();
        if (/^https?:\/\//i.test(vUrl) && /\.mp4(\?|$)/i.test(vUrl)) {
          candidates.push(vUrl);
        }
      }
      candidates.push(media.media_url_https, media.media_url, media.url, media.preview_image_url);
    }
  };

  pushMediaUrls(rawTweet.media);
  pushMediaUrls((rawTweet.extended_entities as Record<string, unknown> | undefined)?.media);
  pushMediaUrls((rawTweet.entities as Record<string, unknown> | undefined)?.media);
  pushMediaUrls((rawTweet.includes as Record<string, unknown> | undefined)?.media);

  const direct = [
    rawTweet.image_url,
    rawTweet.imageUrl,
    rawTweet.photo,
    rawTweet.photo_url,
    rawTweet.thumbnail,
    rawTweet.thumbnail_url,
  ];
  for (const value of [...candidates, ...direct]) {
    const url = String(value ?? "").trim();
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
  }
  return null;
}

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

  const baseText = String(t.text ?? t.full_text ?? t.note_tweet_text ?? "").trim();
  const taggedComment = startsWithCommentTag(baseText);
  const kind: NormalizedIncomingTweet["kind"] = isRepost
    ? "repost"
    : isQuote
      ? "quote"
      : isComment || taggedComment
        ? "comment"
        : "tweet";
  const content = (kind === "tweet" ? baseText : `[${kind}] ${baseText}`).trim();
  const imageUrl = extractTweetImageUrl(t);

  return {
    id,
    handle,
    content,
    imageUrl,
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

// ── USD formatting helpers ───────────────────────────────────
function formatUsdCompact(value: unknown): string {
  const n = typeof value === "string" ? Number(value) : (value as number | null | undefined);
  if (n == null || !Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatUsdPrice(value: unknown): string {
  const n = typeof value === "string" ? Number(value) : (value as number | null | undefined);
  if (n == null || !Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

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
        narrative_tokens (*)
      `)
      .order("posted_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase feed error:", error);
      res.status(500).json({ error: "Failed to fetch feed" });
      return;
    }

    const rows = (data ?? []) as any[];
    const isTerminal = req.query.view === "terminal";

    if (isTerminal) {
      const tweetIdFilter = req.query.tweetId as string | undefined;
      const narrativeFilter = req.query.narrative as string | undefined;
      
      let uniqueTokens: any[] = [];
      
      if (tweetIdFilter) {
        const { data: tweetRows } = await supabase
          .from("narrative_tokens")
          .select("*")
          .eq("tweet_id", tweetIdFilter)
          .order("score", { ascending: false })
          .limit(50);
        uniqueTokens = tweetRows ?? [];
      } else if (narrativeFilter) {
        const { data: narrativeRows } = await supabase
          .from("narrative_tokens")
          .select("*")
          .eq("narrative", narrativeFilter)
          .order("score", { ascending: false })
          .limit(50);
        uniqueTokens = narrativeRows ?? [];
      } else {
        // Group all tokens from all tweets in the feed
        const allTokens: any[] = [];
        for (const row of rows) {
          const ts = Array.isArray(row.narrative_tokens) ? row.narrative_tokens : [];
          allTokens.push(...ts.map((t: any) => ({ ...t, tweet_posted_at: row.posted_at })));
        }

        // Deduplicate by mint
        const uniqueMap = new Map<string, any>();
        for (const t of allTokens) {
          if (!t.token_mint) continue;
          if (!uniqueMap.has(t.token_mint)) {
            uniqueMap.set(t.token_mint, t);
          }
        }
        uniqueTokens = Array.from(uniqueMap.values());
      }

      const enriched = await Promise.all(uniqueTokens.map(async (t) => {
        let change24h = t.returns || "0%";
        let createdAt = t.launched_at;
        
        try {
          const pool = await bagsGetPoolByMint(t.token_mint);
          if (pool) {
            const stats = (pool as any).pool || pool;
            change24h = stats.returns24h || stats.change24h || change24h;
            createdAt = stats.created_at || createdAt;
          }
        } catch (e) {}

        return {
          name: t.token_ticker || t.token_name || "UNKNOWN",
          mint: t.token_mint,
          score: t.score || t.match_score || 0,
          time: toRelativeTime(createdAt),
          createdAt: createdAt,
          change24h: String(change24h),
          mcap: formatUsdCompact(t.current_mcap),
          volume: formatUsdCompact(t.total_volume),
          returns: String(change24h),
          narrative: t.narrative,
          logoUrl: t.logo_url
        };
      }));

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const youngTokens = enriched
        .filter(t => t.createdAt && new Date(t.createdAt) >= oneWeekAgo)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      const oldTokens = enriched
        .filter(t => t.createdAt && new Date(t.createdAt) < oneWeekAgo)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);

      const myAppTokens = enriched
        .filter(t => (t as any).launched_here === true)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      return res.json({
        young: youngTokens,
        old: oldTokens,
        myApp: myAppTokens
      });
    }

    const normalized = rows.map((row) => {
      const creator = row.creators ?? {};
      const tokens = Array.isArray(row.narrative_tokens) ? row.narrative_tokens : [];
      const lowerContent = String(row.content ?? "").toLowerCase();
      const plainText = String(row.content ?? "").replace(/^\[(tweet|repost|quote|comment)\]\s*/i, "");
      const typeKeyword =
        lowerContent.startsWith("[repost]")
          ? "repost"
          : lowerContent.startsWith("[quote]")
            ? "quote"
            : lowerContent.startsWith("[comment]")
              ? "comment"
              : startsWithCommentTag(plainText)
                ? "comment"
                : "tweet";
      return {
        tweetId: row.tweet_id ?? row.id ?? null,
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
        link_preview: row.link_preview ?? null,
        tokens: tokens.map((t: any, i: number) => ({
          rank: i + 1,
          icon: String(t.token_ticker ?? "TK").slice(0, 2).toUpperCase(),
          name: t.token_name ?? "UNKNOWN",
          match: Number(t.match_score ?? 80),
          marketCap: formatUsdCompact(t.current_mcap),
          volume: formatUsdCompact(t.total_volume),
          price: formatUsdPrice(t.current_price),
          returns: String(t.returns ?? "0%"),
          score: Number(t.score ?? 50),
          mint: t.token_mint ?? null,
          age: toRelativeTime(t.launched_at),
          is_on_bags: Boolean(t.is_on_bags),
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

app.get("/api/token/:mint/metrics", async (req, res) => {
  try {
    const mint = String(req.params.mint ?? "").trim();
    if (!mint) {
      res.status(400).json({ error: "mint is required" });
      return;
    }

    const out: {
      mint: string;
      tokenName: string | null;
      tokenTicker: string | null;
      isOnBags: boolean;
      launchedHere: boolean;
      launchedAt: string | null;
      marketCapUsd: number | null;
      priceUsd: number | null;
      volume24hUsd: number | null;
      liquidityUsd: number | null;
      holders: number | null;
      score: number | null;
      logoUrl: string | null;
      sourceTweet: {
        id: string | null;
        content: string | null;
        imageUrl: string | null;
        postedAt: string | null;
      } | null;
      creator: {
        handle: string | null;
        displayName: string | null;
        avatarUrl: string | null;
        followerCount: number | null;
        score: number | null;
      } | null;
    } = {
      mint,
      tokenName: null,
      tokenTicker: null,
      isOnBags: false,
      launchedHere: false,
      launchedAt: null,
      marketCapUsd: null,
      priceUsd: null,
      volume24hUsd: null,
      liquidityUsd: null,
      holders: null,
      score: null,
      logoUrl: null,
      sourceTweet: null,
      creator: null,
    };

    const { data: row } = await supabase
      .from("narrative_tokens")
      .select(
        "token_name,token_ticker,is_on_bags,launched_here,launched_at,current_mcap,current_price,total_volume,score,tweet_id,logo_url",
      )
      .eq("token_mint", mint)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (row) {
      const r = row as Record<string, unknown>;
      out.tokenName = (r.token_name as string | null) ?? null;
      out.tokenTicker = (r.token_ticker as string | null) ?? null;
      out.isOnBags = Boolean(r.is_on_bags);
      out.launchedHere = Boolean(r.launched_here);
      out.launchedAt = (r.launched_at as string | null) ?? null;
      out.marketCapUsd = pickNum(r.current_mcap);
      out.priceUsd = pickNum(r.current_price);
      out.volume24hUsd = pickNum(r.total_volume);
      out.score = pickNum(r.score);
      out.logoUrl = (r.logo_url as string | null) ?? null;

      const tweetId = (r.tweet_id as string | null) ?? null;
      if (tweetId) {
        const { data: tweet } = await supabase
          .from("tweets")
          .select("tweet_id,content,image_url,posted_at,creator_handle")
          .eq("tweet_id", tweetId)
          .maybeSingle();
        if (tweet) {
          const t = tweet as Record<string, unknown>;
          out.sourceTweet = {
            id: (t.tweet_id as string | null) ?? null,
            content: (t.content as string | null) ?? null,
            imageUrl: (t.image_url as string | null) ?? null,
            postedAt: (t.posted_at as string | null) ?? null,
          };
          const handle = (t.creator_handle as string | null) ?? null;
          if (handle) {
            const { data: creator } = await supabase
              .from("creators")
              .select("handle,display_name,avatar_url,follower_count,score")
              .eq("handle", handle)
              .maybeSingle();
            if (creator) {
              const c = creator as Record<string, unknown>;
              out.creator = {
                handle: (c.handle as string | null) ?? null,
                displayName: (c.display_name as string | null) ?? null,
                avatarUrl: (c.avatar_url as string | null) ?? null,
                followerCount: pickNum(c.follower_count),
                score: pickNum(c.score),
              };
            }
          }
        }
      }
    }

    if (bagsConfigured()) {
      try {
        const pool = await bagsGetPoolByMint(mint);
        const p = (pool ?? {}) as Record<string, unknown>;
        const inner =
          (p.data as Record<string, unknown> | undefined) ??
          (p.pool as Record<string, unknown> | undefined) ??
          (p.response as Record<string, unknown> | undefined) ??
          p;

        const parsed = parseBagsPoolStats(pool);
        out.marketCapUsd = out.marketCapUsd ?? parsed.marketCapUsd;
        out.priceUsd = out.priceUsd ?? parsed.priceUsd;
        out.volume24hUsd = out.volume24hUsd ?? parsed.volume24hUsd;
        out.liquidityUsd = pickNum(
          inner.liquidityUsd,
          inner.liquidity_usd,
          inner.liquidity,
          inner.poolLiquidityUsd,
          inner.tvlUsd,
          inner.tvl,
        );
        out.holders = pickNum(
          inner.holderCount,
          inner.holders,
          inner.uniqueHolders,
          inner.holder_count,
        );
        out.score = pickNum(inner.score, inner.scratchScore) ?? out.score;
      } catch (e) {
        console.warn(`[token-metrics] bags lookup failed for ${mint}:`, e);
      }
    }

    res.json(out);
  } catch (err) {
    console.error("[token-metrics] error:", err);
    res.status(500).json({ error: "Failed to fetch token metrics" });
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

      // Upsert narrative_tokens row so the token shows up in feeds & detail pages
      // even if it was launched fresh from a tweet that had no prior token entry.
      // Conflict key: token_mint (must be UNIQUE in the schema).
      if (launch.token_mint) {
        const initialStats = parseBagsPoolStats(pool);
        const nowIso = new Date().toISOString();
        const upsertRow: Record<string, unknown> = {
          token_mint: launch.token_mint,
          token_name: launch.token_name ?? null,
          token_ticker: launch.token_ticker ?? null,
          tweet_id: launch.tweet_id ?? null,
          launched_here: true,
          launched_at: nowIso,
          updated_at: nowIso,
          current_mcap: initialStats.marketCapUsd ?? null,
          current_price: initialStats.priceUsd ?? null,
          total_volume: initialStats.volume24hUsd ?? null,
          is_on_bags: true,
        };
        const { error: upsertErr } = await supabase
          .from("narrative_tokens")
          .upsert(upsertRow, { onConflict: "token_mint" });
        if (upsertErr) {
          console.warn("[launch] narrative_tokens upsert failed:", upsertErr);
        }
      }

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
    if (expectedKey && !safeEqual(receivedKey, expectedKey)) {
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
          image_url: tweet.imageUrl,
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
        // Trigger Narrative Pipeline asynchronously (fire-and-forget)
        runNarrativePipeline({
          tweet_id: tweet.id,
          content: tweet.content,
          creator_handle: creator.handle
        }).catch((err) =>
          console.error(`[Pipeline] failed for tweet ${tweet.id}:`, err)
        );

        // Link Preview: Scan for t.co links and enrich in background
        const tcoMatch = tweet.content.match(/https:\/\/t\.co\/\S+/);
        if (tcoMatch) {
          const tcoUrl = tcoMatch[0];
          fetchLinkPreview(tcoUrl)
            .then(async (preview) => {
              if (!preview) return;
              const { error: upErr } = await supabase
                .from("tweets")
                .update({ link_preview: preview })
                .eq("tweet_id", tweet.id);
              if (upErr) console.error(`[LinkPreview] DB update fail for ${tweet.id}:`, upErr.message);
            })
            .catch((err) => console.error(`[LinkPreview] service fail for ${tweet.id}:`, err));
        }
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

async function backfillMissingTweetImagesOnce(opts?: { limit?: number; maxAgeHours?: number }): Promise<{
  scanned: number;
  fetched: number;
  updated: number;
}> {
  const apiKey = process.env.TWITTERAPI_IO_KEY?.trim();
  if (!apiKey) return { scanned: 0, fetched: 0, updated: 0 };

  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 200), 1000));
  const maxAgeHours = Math.max(1, Number(opts?.maxAgeHours ?? 24 * 14));
  const sinceIso = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("tweets")
    .select("tweet_id,content")
    .is("image_url", null)
    .gte("posted_at", sinceIso)
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[image-backfill] supabase select error:", error);
    return { scanned: 0, fetched: 0, updated: 0 };
  }

  const ids = (rows ?? [])
    .map((r: { tweet_id?: string | null }) => String(r.tweet_id ?? "").trim())
    .filter(Boolean);
  if (ids.length === 0) return { scanned: 0, fetched: 0, updated: 0 };

  const CHUNK_SIZE = 50;
  let fetched = 0;
  let updated = 0;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const url = `https://api.twitterapi.io/twitter/tweets?tweet_ids=${encodeURIComponent(chunk.join(","))}`;
    try {
      const r = await fetch(url, { headers: { "x-api-key": apiKey } });
      if (!r.ok) {
        console.warn(`[image-backfill] api ${r.status}: ${await r.text().catch(() => "")}`);
        continue;
      }
      const body = (await r.json()) as { tweets?: Array<Record<string, unknown>>; data?: Record<string, unknown> };
      const list: Array<Record<string, unknown>> = Array.isArray(body?.tweets)
        ? body.tweets
        : Array.isArray((body?.data as { tweets?: unknown[] })?.tweets)
          ? ((body.data as { tweets: Array<Record<string, unknown>> }).tweets)
          : [];

      fetched += list.length;
      for (const t of list) {
        const id = String(t.id ?? t.tweet_id ?? "").trim();
        if (!id) continue;
        const imageUrl = extractTweetImageUrl(t);
        if (!imageUrl) continue;
        const { error: upErr } = await supabase
          .from("tweets")
          .update({ image_url: imageUrl })
          .eq("tweet_id", id)
          .is("image_url", null);
        if (upErr) {
          console.warn(`[image-backfill] update fail id=${id}:`, upErr.message);
        } else {
          updated++;
        }
      }
    } catch (err) {
      console.error("[image-backfill] fetch error:", err);
    }
  }

  console.log(`[image-backfill] scanned=${ids.length} fetched=${fetched} updated=${updated}`);
  return { scanned: ids.length, fetched, updated };
}

async function backfillTweetKindsOnce(opts?: { limit?: number; maxAgeHours?: number }): Promise<{
  scanned: number;
  updated: number;
}> {
  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 500), 5000));
  const maxAgeHours = Math.max(1, Number(opts?.maxAgeHours ?? 24 * 30));
  const sinceIso = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("tweets")
    .select("tweet_id,content")
    .gte("posted_at", sinceIso)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[kind-backfill] supabase select error:", error);
    return { scanned: 0, updated: 0 };
  }

  const items = (rows ?? []) as Array<{ tweet_id?: string | null; content?: string | null }>;
  let updated = 0;
  for (const row of items) {
    const id = String(row.tweet_id ?? "").trim();
    if (!id) continue;
    const content = String(row.content ?? "");
    const lower = content.toLowerCase().trim();
    const hasPrefix = /^\[(tweet|repost|quote|comment)\]\s*/i.test(content);
    if (hasPrefix || !startsWithCommentTag(content)) continue;
    const patched = `[comment] ${content}`.trim();
    const { error: upErr } = await supabase.from("tweets").update({ content: patched }).eq("tweet_id", id);
    if (!upErr) updated++;
  }
  console.log(`[kind-backfill] scanned=${items.length} updated=${updated}`);
  return { scanned: items.length, updated };
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

app.post("/api/admin/twitterapi/backfill-images", async (req, res) => {
  const limit = Number(req.body?.limit ?? 200);
  const maxAgeHours = Number(req.body?.maxAgeHours ?? 24 * 14);
  const result = await backfillMissingTweetImagesOnce({ limit, maxAgeHours });
  res.json({ ok: true, ...result });
});

app.post("/api/admin/twitterapi/backfill-kinds", async (req, res) => {
  const limit = Number(req.body?.limit ?? 500);
  const maxAgeHours = Number(req.body?.maxAgeHours ?? 24 * 30);
  const result = await backfillTweetKindsOnce({ limit, maxAgeHours });
  res.json({ ok: true, ...result });
});

app.post("/api/admin/backfill-narratives", async (req, res) => {
  const limit = Math.min(Number(req.body?.limit ?? 5), 20); // Cap at 20 to manage costs
  const { data: tweets, error } = await supabase
    .from("tweets")
    .select("tweet_id, content")
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error || !tweets) {
    return res.status(500).json({ error: "Failed to fetch tweets for backfill" });
  }

  console.log(`[NarrativeBackfill] Starting for ${tweets.length} tweets...`);

  // Run in background (fire-and-forget)
  for (const tweet of tweets) {
    runNarrativePipeline({
      tweet_id: String(tweet.tweet_id),
      content: String(tweet.content)
    }).catch(err => console.error(`[Backfill] Fail for ${tweet.tweet_id}:`, err));
  }

  res.json({ ok: true, scheduled: tweets.length, hint: "Check server logs for progress." });
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

// ── Bags token stats refresher ───────────────────────────────
/**
 * Pulls live market data (mcap, price, volume) from Bags for every
 * narrative_tokens row that has a token_mint, and writes back to Supabase.
 *
 * Bags' pool response shape is undocumented in the SDK, so we extract values
 * defensively from common candidate paths/keys.
 */
type BagsPoolStats = {
  marketCapUsd: number | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
};

function pickNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === "string" ? Number(v) : (v as number);
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

function parseBagsPoolStats(pool: unknown): BagsPoolStats {
  if (!pool || typeof pool !== "object") {
    return { marketCapUsd: null, priceUsd: null, volume24hUsd: null };
  }
  const p = pool as Record<string, unknown>;
  // Bags often wraps the actual pool under .data, .pool, or .response
  const inner =
    (p.data as Record<string, unknown> | undefined) ??
    (p.pool as Record<string, unknown> | undefined) ??
    (p.response as Record<string, unknown> | undefined) ??
    p;
  const marketCapUsd = pickNum(
    inner.marketCapUsd,
    inner.mcapUsd,
    inner.mcap,
    inner.marketCap,
    inner.market_cap,
    inner.fdvUsd,
    inner.fdv,
  );
  const priceUsd = pickNum(
    inner.priceUsd,
    inner.price_usd,
    inner.price,
    inner.tokenPriceUsd,
    inner.lastPriceUsd,
  );
  const volume24hUsd = pickNum(
    inner.volume24hUsd,
    inner.volume_24h_usd,
    inner.volumeUsd,
    inner.volume,
    inner.volume24h,
    inner.totalVolumeUsd,
    inner.total_volume,
  );
  return { marketCapUsd, priceUsd, volume24hUsd };
}

async function refreshBagsTokenStatsOnce(): Promise<void> {
  if (!bagsConfigured()) return;
  const limit = Number(process.env.BAGS_REFRESH_LIMIT ?? 50);
  const rpcUrl = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

  // Pull tokens that need refresh
  const { data, error } = await supabase
    .from("narrative_tokens")
    .select("*")
    .not("token_mint", "is", null)
    .limit(limit);

  if (error) {
    console.error("[bags-refresh] select error:", error.message);
    return;
  }
  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    console.log("[bags-refresh] no tokens to refresh");
    return;
  }

  let updated = 0;
  for (const row of rows) {
    try {
      const mint = row.token_mint;
      // Only score tokens ending with "bags" as requested
      const shouldScore = String(mint).toLowerCase().endsWith("bags");

      const pool = await bagsGetPoolByMint(mint);
      const p = (pool ?? {}) as Record<string, unknown>;
      const inner =
        (p.data as Record<string, unknown> | undefined) ??
        (p.pool as Record<string, unknown> | undefined) ??
        (p.response as Record<string, unknown> | undefined) ??
        p;

      const stats = parseBagsPoolStats(pool);
      const liquidity = pickNum(
        inner.liquidityUsd,
        inner.liquidity_usd,
        inner.liquidity,
        inner.poolLiquidityUsd,
        inner.tvlUsd,
        inner.tvl,
      );
      const holders = pickNum(
        inner.holderCount,
        inner.holders,
        inner.uniqueHolders,
        inner.holder_count,
      );
      const lifecycle = (inner.lifecycle || inner.status || "PRE_LAUNCH") as any;

      const patch: Record<string, any> = {
        current_mcap: stats.marketCapUsd,
        current_price: stats.priceUsd,
        total_volume: stats.volume24hUsd,
        liquidity,
        holders,
        lifecycle,
        updated_at: new Date().toISOString(),
      };

      if (shouldScore) {
        // Run concentration check if holders changed significantly or never run
        let top1 = row.top1_holder_pct;
        let top5 = row.top5_holder_pct;
        let flag = row.concentration_flag;

        const holderDiff = Math.abs((holders ?? 0) - (row.holders ?? 0));
        const significantChange = row.holders ? holderDiff / row.holders > 0.2 : true;

        if (significantChange || top1 === null) {
          const conc = await getConcentrationData(mint, rpcUrl);
          top1 = conc.top1Pct;
          top5 = conc.top5Pct;
          flag = conc.flag;
          patch.top1_holder_pct = top1;
          patch.top5_holder_pct = top5;
          patch.concentration_flag = flag;
        }

        const score = calculateScratchScore({
          mcap: stats.marketCapUsd ?? 0,
          volume24h: stats.volume24hUsd ?? 0,
          liquidity: liquidity ?? 0,
          holders: holders ?? 0,
          lifecycle,
          twitter: row.twitter,
          telegram: row.telegram,
          website: row.website,
          buyerRank: row.buyer_rank,
          returns: row.returns,
          top1HolderPct: top1,
          top5HolderPct: top5,
        });

        patch.score = score;
        console.log(`[bags-refresh] Scored ${mint}: ${score}`);
      }

      const { error: upErr } = await supabase
        .from("narrative_tokens")
        .update(patch)
        .eq("id", row.id);

      if (upErr) {
        console.warn(`[bags-refresh] update fail id=${row.id}:`, upErr.message);
      } else {
        updated++;
      }
    } catch (e) {
      console.warn(
        `[bags-refresh] fetch fail mint=${row.token_mint}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  console.log(`[bags-refresh] refreshed=${updated}/${rows.length}`);
}

function startBagsRefresher(): void {
  const intervalMs = Number(process.env.BAGS_REFRESH_INTERVAL_MS ?? 600_000); // 10 min
  if (intervalMs <= 0) {
    console.log("[bags-refresh] disabled (BAGS_REFRESH_INTERVAL_MS<=0)");
    return;
  }
  console.log(`[bags-refresh] enabled, interval=${Math.round(intervalMs / 1000)}s`);
  setTimeout(() => {
    void refreshBagsTokenStatsOnce();
    setInterval(() => void refreshBagsTokenStatsOnce(), intervalMs);
  }, 30_000);
}

app.post("/api/admin/bags/refresh-tokens", async (_req, res) => {
  await refreshBagsTokenStatsOnce();
  res.json({ ok: true });
});


// ── Admin: Backfill Narrative Pipeline ───────────────────────
app.post("/api/admin/backfill-narratives", async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 10);
    const { data: tweets, error } = await supabase
      .from("tweets")
      .select("tweet_id, content, creator_handle")
      .order("posted_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const results = [];
    for (const tweet of (tweets ?? [])) {
      console.log(`[Backfill] Processing tweet ${tweet.tweet_id}...`);
      await runNarrativePipeline({
        tweet_id: String(tweet.tweet_id),
        content: String(tweet.content),
        creator_handle: tweet.creator_handle as string | undefined,
      }).catch(err => console.error(`[Backfill] Fail for ${tweet.tweet_id}:`, err));
      results.push(tweet.tweet_id);
    }

    res.json({ success: true, processed: results.length, tweet_ids: results });
  } catch (err) {
    console.error("Backfill error:", err);
    res.status(500).json({ error: "Backfill failed" });
  }
});

app.listen(PORT, () => {
  console.log(`[feed-api] listening on port ${PORT}`);
  startMetricsRefresher();
  startCleanupJob();
  startBagsRefresher();
  startFeedCacheRefresher();
});
