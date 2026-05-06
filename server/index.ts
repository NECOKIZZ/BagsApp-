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

      // DB-only read. Cron (`refreshBagsTokenStatsOnce`) is responsible for
      // keeping current_mcap / total_volume / returns / score fresh. Calling
      // Bags here per-request caused N×400s on every page load.
      const enriched = uniqueTokens.map((t) => {
        const change24h = t.returns || "0%";
        const createdAt = t.launched_at;
        return {
          name: t.token_ticker || t.token_name || "UNKNOWN",
          mint: t.token_mint,
          launched_here: Boolean(t.launched_here),
          is_on_bags: Boolean(t.is_on_bags),
          score: t.score || t.match_score || 0,
          time: toRelativeTime(createdAt),
          createdAt: createdAt,
          change24h: String(change24h),
          mcap: formatUsdCompact(t.current_mcap),
          volume: formatUsdCompact(t.total_volume),
          returns: String(change24h),
          narrative: t.narrative,
          logoUrl: t.logo_url,
        };
      });

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

// In-memory TTL cache for /api/token/:mint/metrics responses.
// Bags + Jupiter calls take 500-1500ms each; caching for 60s collapses
// repeat detail-page views into instant DB-only reads.
const METRICS_CACHE_TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS ?? 60_000);
const metricsCache = new Map<string, { ts: number; data: unknown }>();

app.get("/api/token/:mint/metrics", async (req, res) => {
  try {
    const requestedMint = String(req.params.mint ?? "").trim();
    const mint = normalizeTokenMintCandidate(requestedMint);
    if (!mint) {
      res.status(400).json({ error: "mint is required" });
      return;
    }

    // Serve cached response if still fresh.
    const cached = metricsCache.get(mint);
    if (cached && Date.now() - cached.ts < METRICS_CACHE_TTL_MS) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", `public, max-age=${Math.floor(METRICS_CACHE_TTL_MS / 1000)}`);
      return res.json(cached.data);
    }
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", `public, max-age=${Math.floor(METRICS_CACHE_TTL_MS / 1000)}`);

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

    const mintCandidates = Array.from(new Set([mint, requestedMint].filter(Boolean)));
    const { data: rows } = await supabase
      .from("narrative_tokens")
      .select(
        "token_name,token_ticker,is_on_bags,launched_here,launched_at,current_mcap,current_price,total_volume,score,tweet_id,logo_url",
      )
      .in("token_mint", mintCandidates)
      .order("updated_at", { ascending: false })
      .limit(1);

    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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

    // Skip Bags call if DB already says this mint is not a Bags token.
    // Saves a guaranteed-400 round trip on every detail-page view of a
    // pump.fun / generic Jupiter token.
    const skipBags = row && row.is_on_bags === false;

    // Bags pool metadata (socials/buyer_rank/returns) captured for persistence.
    // Defaults are null so we can pass straight to persistTokenMetricsToDb.
    let bagsMeta: ReturnType<typeof parseBagsPoolMeta> | null = null;

    if (bagsConfigured() && isValidSolanaMintAddress(mint) && !skipBags) {
      try {
        const pool = await bagsGetPoolByMint(mint);
        const p = (pool ?? {}) as Record<string, unknown>;
        const inner =
          (p.data as Record<string, unknown> | undefined) ??
          (p.pool as Record<string, unknown> | undefined) ??
          (p.response as Record<string, unknown> | undefined) ??
          p;

        // If Bags returns 200 for this mint, treat it as listed on Bags
        // even when local DB hasn't been enriched yet.
        out.isOnBags = true;

        const parsed = parseBagsPoolStats(pool);
        bagsMeta = parseBagsPoolMeta(pool);
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
        // 400 = mint not on Bags. Flip the flag so we don't keep asking.
        if (e instanceof BagsApiError && e.status === 400) {
          out.isOnBags = false;
          await supabase
            .from("narrative_tokens")
            .update({ is_on_bags: false, updated_at: new Date().toISOString() })
            .eq("token_mint", mint);
        } else {
          console.warn(`[token-metrics] bags lookup failed for ${mint}:`, e);
        }
      }
    }

    // Fallback for tokens not on Bags (or when Bags has sparse data):
    // pull rich metadata (logo, name, symbol, price, mcap, volume) from
    // Jupiter's token-search. This is the only source for pump.fun and
    // generic Jupiter-listed tokens.
    let jupMeta: Awaited<ReturnType<typeof fetchJupiterTokenMeta>> = null;
    if (!out.isOnBags) {
      jupMeta = await fetchJupiterTokenMeta(mint);
      if (jupMeta) {
        if (out.logoUrl == null && jupMeta.logoURI) out.logoUrl = jupMeta.logoURI;
        if (out.tokenName == null && jupMeta.name) out.tokenName = jupMeta.name;
        if (out.tokenTicker == null && jupMeta.symbol) out.tokenTicker = jupMeta.symbol;
        if (out.priceUsd == null && jupMeta.usdPrice != null) out.priceUsd = jupMeta.usdPrice;
        if (out.marketCapUsd == null) out.marketCapUsd = jupMeta.mcap ?? jupMeta.fdv ?? null;
        if (out.volume24hUsd == null && jupMeta.volume24hUsd != null) out.volume24hUsd = jupMeta.volume24hUsd;
        if (out.liquidityUsd == null && jupMeta.liquidityUsd != null) out.liquidityUsd = jupMeta.liquidityUsd;
        if (out.holders == null && jupMeta.holderCount != null) out.holders = jupMeta.holderCount;
      }
    }

    if (out.priceUsd == null) {
      const jupPrice = await fetchJupiterPriceUsd(mint);
      if (jupPrice != null) {
        out.priceUsd = jupPrice;
      }
    }
    if (out.marketCapUsd == null && out.priceUsd != null) {
      const supplyUi = await fetchTokenSupplyUi(mint);
      if (supplyUi != null) {
        out.marketCapUsd = out.priceUsd * supplyUi;
      }
    }

    // Persist freshly-fetched metadata back to narrative_tokens so the
    // feed/terminal endpoints (which read straight from DB) stay in sync
    // without relying solely on the 10-min cron jobs. Fire-and-forget.
    void persistTokenMetricsToDb(mint, out, bagsMeta, jupMeta).catch((e) =>
      console.warn(`[token-metrics] persist failed for ${mint}:`, e instanceof Error ? e.message : String(e)),
    );

    // Cache the assembled response for METRICS_CACHE_TTL_MS.
    metricsCache.set(mint, { ts: Date.now(), data: out });
    // Soft cap on cache size so a runaway crawler can't OOM the process.
    if (metricsCache.size > 500) {
      const oldestKey = metricsCache.keys().next().value;
      if (oldestKey) metricsCache.delete(oldestKey);
    }

    res.json(out);
  } catch (err) {
    console.error("[token-metrics] error:", err);
    res.status(500).json({ error: "Failed to fetch token metrics" });
  }
});

/**
 * Writes the assembled token metrics back to narrative_tokens.
 * Updates rows whose token_mint matches; safe no-op if no rows exist.
 * Only writes non-null fields so we never blank out existing data.
 */
async function persistTokenMetricsToDb(
  mint: string,
  out: {
    isOnBags: boolean;
    tokenName: string | null;
    tokenTicker: string | null;
    logoUrl: string | null;
    marketCapUsd: number | null;
    priceUsd: number | null;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    holders: number | null;
    score: number | null;
  },
  bagsMeta: ReturnType<typeof parseBagsPoolMeta> | null,
  jupMeta: Awaited<ReturnType<typeof fetchJupiterTokenMeta>>,
): Promise<void> {
  const patch: Record<string, unknown> = {
    is_on_bags: out.isOnBags,
    updated_at: new Date().toISOString(),
  };
  if (out.tokenName) patch.token_name = out.tokenName;
  if (out.tokenTicker) patch.token_ticker = out.tokenTicker;
  if (out.logoUrl) patch.logo_url = out.logoUrl;
  if (out.marketCapUsd != null) patch.current_mcap = out.marketCapUsd;
  if (out.priceUsd != null) patch.current_price = out.priceUsd;
  if (out.volume24hUsd != null) patch.total_volume = out.volume24hUsd;
  if (out.liquidityUsd != null) patch.liquidity = out.liquidityUsd;
  if (out.holders != null) patch.holders = out.holders;
  if (out.score != null) patch.score = out.score;

  // Bags pool metadata (socials/buyer_rank/returns) — only set if non-null
  // so we never overwrite existing data with blank values.
  if (bagsMeta) {
    if (bagsMeta.twitter)    patch.twitter = bagsMeta.twitter;
    if (bagsMeta.telegram)   patch.telegram = bagsMeta.telegram;
    if (bagsMeta.website)    patch.website = bagsMeta.website;
    if (bagsMeta.buyerRank != null) patch.buyer_rank = bagsMeta.buyerRank;
    if (bagsMeta.returns24h) patch.returns = bagsMeta.returns24h;
  }

  // Jupiter quality signals — persist verified flag explicitly (false is
  // meaningful; null means "we never asked"). organicScore only when fetched.
  if (jupMeta) {
    patch.jupiter_verified = jupMeta.verified;
    if (jupMeta.organicScore != null) patch.jupiter_organic_score = jupMeta.organicScore;
  }

  // Try the update with all known columns; if Postgrest rejects unknown columns
  // (schema cache miss), strip them and retry. Same defensive pattern as
  // updateNarrativeTokenWithColumnFallback but keyed on token_mint.
  let nextPatch: Record<string, unknown> = { ...patch };
  for (let i = 0; i < 8; i++) {
    const { error } = await supabase
      .from("narrative_tokens")
      .update(nextPatch)
      .eq("token_mint", mint);
    if (!error) return;
    const msg = String((error as { message?: string }).message ?? "");
    const missingCol = msg.match(/Could not find the '([^']+)' column/i)?.[1];
    if (!missingCol || !(missingCol in nextPatch)) {
      console.warn(`[token-metrics] persist update error for ${mint}:`, msg);
      return;
    }
    delete nextPatch[missingCol];
  }
}

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

/**
 * Replay a single tweet through the narrative pipeline and report the
 * resulting narrative_tokens rows. Useful for end-to-end test runs against
 * known historical tweets without waiting for a live ingestion event.
 *
 * POST body: { tweet_id: string }
 *   or:      { handle?: string }  → picks the most recent tweet from that handle
 *   or:      {}                   → picks the most recent tweet overall
 */
/**
 * Read-only inspect: returns narrative_tokens rows for a given tweet_id
 * without modifying anything. Use after `/api/admin/replay-tweet` + the
 * enrichment crons to see final scores.
 */
app.get("/api/admin/tweet-tokens/:tweetId", async (req, res) => {
  try {
    const tweetId = String(req.params.tweetId ?? "").trim();
    if (!tweetId) return res.status(400).json({ error: "Missing tweetId" });
    const { data, error } = await supabase
      .from("narrative_tokens")
      .select("*")
      .eq("tweet_id", tweetId)
      .order("score", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, tweet_id: tweetId, count: data?.length ?? 0, tokens: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/replay-tweet", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { tweet_id?: unknown; handle?: unknown };
    const tweetIdInput = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
    const handleInput = typeof body.handle === "string"
      ? body.handle.trim().replace(/^@/, "").toLowerCase()
      : "";

    // Select narrative defensively — older DBs don't have that column.
    const baseCols = "tweet_id, content, creator_handle, posted_at";
    const buildQuery = (cols: string) => {
      let q = supabase.from("tweets").select(cols)
        .order("posted_at", { ascending: false })
        .limit(1);
      if (tweetIdInput) q = q.eq("tweet_id", tweetIdInput);
      else if (handleInput) q = q.ilike("creator_handle", handleInput);
      return q;
    };

    let { data: tweetRows, error: fetchErr } = await buildQuery(`${baseCols}, narrative`);
    if (fetchErr && /narrative.*does not exist/i.test(fetchErr.message)) {
      ({ data: tweetRows, error: fetchErr } = await buildQuery(baseCols));
    }
    if (fetchErr) {
      return res.status(500).json({ error: "Tweet lookup failed", detail: fetchErr.message });
    }
    const tweet = tweetRows?.[0];
    if (!tweet) {
      return res.status(404).json({ error: "No matching tweet found" });
    }

    const tweetId = String(tweet.tweet_id);
    const content = String(tweet.content ?? "");
    const handle = tweet.creator_handle ? String(tweet.creator_handle) : undefined;

    console.log(`[replay-tweet] Replaying ${tweetId} (@${handle ?? "unknown"})`);

    // Wipe prior narrative_tokens for this tweet so we observe a clean run.
    await supabase.from("narrative_tokens").delete().eq("tweet_id", tweetId);

    // Run the pipeline synchronously so we can return the result.
    await runNarrativePipeline({ tweet_id: tweetId, content, creator_handle: handle });

    // Read back the freshly-written rows.
    const { data: tokens, error: readErr } = await supabase
      .from("narrative_tokens")
      .select("*")
      .eq("tweet_id", tweetId)
      .order("score", { ascending: false });
    if (readErr) {
      return res.status(500).json({ error: "Read-back failed", detail: readErr.message });
    }

    res.json({
      ok: true,
      tweet: {
        tweet_id: tweetId,
        creator_handle: handle ?? null,
        posted_at: tweet.posted_at ?? null,
        content_preview: content.slice(0, 200),
        narrative: tweet.narrative ?? null,
      },
      tokens: tokens ?? [],
      hint: "Score will refine on the next bags-refresh / jupiter-meta cron cycle (or hit /api/admin/bags/refresh-tokens and /api/admin/jupiter/refresh-metadata to trigger immediately).",
    });
  } catch (err) {
    console.error("[replay-tweet] error:", err);
    res.status(500).json({ error: "Internal error", detail: err instanceof Error ? err.message : String(err) });
  }
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
    inner.priceInUsd,
    inner.usdPrice,
    inner.usd_price,
    inner.price,
    inner.tokenPriceUsd,
    inner.lastPriceUsd,
  );
  const volume24hUsd = pickNum(
    inner.volume24hUsd,
    inner.volume_24h_usd,
    inner.volume24h,
    inner.volume24hUSD,
    inner.volumeUsd24h,
    inner.volume_usd_24h,
    inner.volumeUsd,
    inner.volume,
    inner.totalVolumeUsd,
    inner.total_volume,
  );
  return { marketCapUsd, priceUsd, volume24hUsd };
}

/**
 * Extracts the *additional* metadata fields the Scratch Score formula needs:
 * socials, buyer rank, 24h returns. Bags' pool API exposes some of these
 * directly on the pool record and others nested under socials/links sub-objects;
 * we check every plausible field name defensively so the score formula sees
 * real values instead of permanent nulls.
 *
 * Returns null fields when not present — the formula treats them as 0
 * contribution rather than disqualifying the token.
 */
function parseBagsPoolMeta(pool: unknown): {
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  buyerRank: number | null;
  returns24h: string | null;
} {
  const empty = { twitter: null, telegram: null, website: null, buyerRank: null, returns24h: null };
  if (!pool || typeof pool !== "object") return empty;

  const p = pool as Record<string, unknown>;
  const inner =
    (p.data as Record<string, unknown> | undefined) ??
    (p.pool as Record<string, unknown> | undefined) ??
    (p.response as Record<string, unknown> | undefined) ??
    p;

  const socials =
    (inner.socials as Record<string, unknown> | undefined) ??
    (inner.links as Record<string, unknown> | undefined) ??
    (inner.metadata as Record<string, unknown> | undefined) ??
    {};

  const pickStr = (...candidates: unknown[]): string | null => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return null;
  };

  const twitter = pickStr(
    inner.twitter,
    inner.twitterUrl,
    inner.twitter_url,
    inner.x,
    inner.xUrl,
    socials.twitter,
    socials.x,
    socials.twitterUrl,
    socials.twitter_url,
  );
  const telegram = pickStr(
    inner.telegram,
    inner.telegramUrl,
    inner.telegram_url,
    inner.tg,
    socials.telegram,
    socials.tg,
    socials.telegramUrl,
  );
  const website = pickStr(
    inner.website,
    inner.websiteUrl,
    inner.website_url,
    inner.homepage,
    inner.url,
    socials.website,
    socials.homepage,
    socials.url,
  );
  const buyerRank = pickNum(
    inner.buyerRank,
    inner.buyer_rank,
    inner.creatorRank,
    inner.creator_rank,
    inner.rank,
  );
  const returns24h = pickStr(
    inner.returns24h,
    inner.returns_24h,
    inner.change24h,
    inner.change_24h,
    inner.priceChange24h,
    inner.price_change_24h,
  );

  return { twitter, telegram, website, buyerRank, returns24h };
}

function normalizeTokenMintCandidate(input: unknown): string {
  // Pump.fun mints legitimately end in "pump" (vanity suffix that IS part of
  // the on-chain base58 address). DO NOT strip — that produces an invalid mint.
  // Trust the value as stored; rely on isValidSolanaMintAddress() for validation.
  return String(input ?? "").trim();
}

function isValidSolanaMintAddress(mint: string): boolean {
  if (!mint) return false;
  try {
    return bs58.decode(mint).length === 32;
  } catch {
    return false;
  }
}

async function updateNarrativeTokenWithColumnFallback(
  rowId: string,
  patch: Record<string, any>,
  logPrefix: string = "narrative-tokens",
): Promise<{ error: { message: string } | null }> {
  let nextPatch: Record<string, any> = { ...patch };
  for (let i = 0; i < 8; i++) {
    const { error } = await supabase.from("narrative_tokens").update(nextPatch).eq("id", rowId);
    if (!error) return { error: null };

    const msg = String((error as any)?.message ?? "");
    const missingCol = msg.match(/Could not find the '([^']+)' column/i)?.[1];
    if (!missingCol || !(missingCol in nextPatch)) {
      return { error: { message: msg || "unknown update error" } };
    }
    delete nextPatch[missingCol];
    console.warn(`[${logPrefix}] missing column "${missingCol}" in schema cache; retrying update`);
  }
  return { error: { message: "failed after retrying update without missing columns" } };
}

async function fetchJupiterPriceUsd(mint: string): Promise<number | null> {
  if (!mint) return null;
  const apiKey = (process.env.JUPITER_API_KEY ?? "").trim();
  const host = apiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag";
  const headers: Record<string, string> = apiKey ? { "x-api-key": apiKey } : {};
  const timeoutMs = Number(process.env.JUPITER_HTTP_TIMEOUT_MS ?? 5000);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const v2 = await fetch(`${host}/price/v2?ids=${encodeURIComponent(mint)}`, {
      headers,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (v2.ok) {
      const body = (await v2.json()) as { data?: Record<string, { price?: number | string }> };
      const raw = body?.data?.[mint]?.price;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const v3 = await fetch(`${host}/price/v3?ids=${encodeURIComponent(mint)}`, {
      headers,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (v3.ok) {
      const body = (await v3.json()) as Record<string, { usdPrice?: number | string }>;
      const raw = body?.[mint]?.usdPrice;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}

  return null;
}

async function fetchTokenSupplyUi(mint: string): Promise<number | null> {
  if (!mint) return null;
  const rpcUrl = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
  const timeoutMs = Number(process.env.SOLANA_RPC_TIMEOUT_MS ?? 5000);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [mint],
      }),
    }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const body = (await r.json()) as {
      result?: { value?: { uiAmount?: number | null } };
      error?: { message?: string };
    };
    if (body.error) return null;
    const uiAmount = body.result?.value?.uiAmount;
    return typeof uiAmount === "number" && Number.isFinite(uiAmount) ? uiAmount : null;
  } catch {
    return null;
  }
}

async function refreshBagsTokenStatsOnce(): Promise<void> {
  if (!bagsConfigured()) return;
  const limit = Number(process.env.BAGS_REFRESH_LIMIT ?? 50);
  const rpcUrl = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

  // Pull tokens that need refresh.
  // Only fetch tokens flagged as Bags-launched. Bags' API returns 400 for any
  // mint not in its catalog (pump.fun, generic Jupiter tokens), so we'd just
  // burn rate limit on guaranteed failures. is_on_bags is set true at insert
  // time when matched against the Bags pool list, and flipped false below if
  // Bags returns 400 for it.
  const { data, error } = await supabase
    .from("narrative_tokens")
    .select("*")
    .not("token_mint", "is", null)
    .eq("is_on_bags", true)
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
      const rawMint = row.token_mint;
      const mint = normalizeTokenMintCandidate(rawMint);
      if (!isValidSolanaMintAddress(mint)) {
        console.warn(`[bags-refresh] skipping invalid mint id=${row.id}: ${String(rawMint)}`);
        continue;
      }
      let pool: unknown;
      try {
        pool = await bagsGetPoolByMint(mint);
      } catch (poolErr) {
        // 400 = Bags doesn't have this mint. Flip the flag so we stop asking.
        if (poolErr instanceof BagsApiError && poolErr.status === 400) {
          await supabase
            .from("narrative_tokens")
            .update({ is_on_bags: false, updated_at: new Date().toISOString() })
            .eq("id", row.id);
          console.log(`[bags-refresh] mint not on Bags, flipped is_on_bags=false: ${mint}`);
          continue;
        }
        throw poolErr;
      }
      const p = (pool ?? {}) as Record<string, unknown>;
      const inner =
        (p.data as Record<string, unknown> | undefined) ??
        (p.pool as Record<string, unknown> | undefined) ??
        (p.response as Record<string, unknown> | undefined) ??
        p;

      const stats = parseBagsPoolStats(pool);
      const meta = parseBagsPoolMeta(pool);
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

      // Persist Bags-pool metadata so the scoring formula sees real values
      // instead of permanent nulls. Only write fields we actually parsed —
      // never overwrite existing data with null.
      if (meta.twitter)    patch.twitter = meta.twitter;
      if (meta.telegram)   patch.telegram = meta.telegram;
      if (meta.website)    patch.website = meta.website;
      if (meta.buyerRank != null) patch.buyer_rank = meta.buyerRank;
      if (meta.returns24h) patch.returns = meta.returns24h;

      // Concentration: compute when missing OR when holders moved >20%.
      // No `shouldScore` gate — the formula uses these for ALL Bags tokens.
      let top1 = row.top1_holder_pct;
      let top5 = row.top5_holder_pct;
      let flag = row.concentration_flag;
      const holderDiff = Math.abs((holders ?? 0) - (row.holders ?? 0));
      const significantChange = row.holders ? holderDiff / row.holders > 0.2 : true;
      if (top1 == null || significantChange) {
        const conc = await getConcentrationData(mint, rpcUrl);
        top1 = conc.top1Pct;
        top5 = conc.top5Pct;
        flag = conc.flag;
        patch.top1_holder_pct = top1;
        patch.top5_holder_pct = top5;
        patch.concentration_flag = flag;
      }

      // Score every Bags token, every cycle. Pass merged data: freshly-parsed
      // pool metadata (overrides) + persisted row fields + Jupiter signals if
      // this token also has Jupiter data on file (some tokens are on both).
      const score = calculateScratchScore({
        mcap: stats.marketCapUsd ?? 0,
        volume24h: stats.volume24hUsd ?? 0,
        liquidity: liquidity ?? 0,
        holders: holders ?? 0,
        lifecycle,
        twitter: meta.twitter ?? row.twitter ?? undefined,
        telegram: meta.telegram ?? row.telegram ?? undefined,
        website: meta.website ?? row.website ?? undefined,
        buyerRank: meta.buyerRank ?? row.buyer_rank ?? undefined,
        returns: meta.returns24h ?? row.returns ?? undefined,
        top1HolderPct: top1 ?? undefined,
        top5HolderPct: top5 ?? undefined,
        jupiterVerified: row.jupiter_verified === true,
        jupiterOrganicScore:
          typeof row.jupiter_organic_score === "number" ? row.jupiter_organic_score : undefined,
      });
      patch.score = score;
      console.log(`[bags-refresh] Scored ${mint}: ${score}`);

      if (mint !== rawMint) {
        patch.token_mint = mint;
      }
      const { error: upErr } = await updateNarrativeTokenWithColumnFallback(String(row.id), patch, "bags-refresh");

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

// ── Jupiter metadata enrichment ──────────────────────────────
/**
 * Fetches metadata for a single mint from Jupiter's token-search endpoint.
 * Returns name/symbol/logoURI plus market data (price, mcap, volume, holders).
 * Used to enrich non-Bags tokens (pump.fun, generic Solana mints).
 */
type JupiterTokenMeta = {
  name: string | null;
  symbol: string | null;
  logoURI: string | null;
  usdPrice: number | null;
  mcap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  organicScore: number | null;
  verified: boolean;
};

async function fetchJupiterTokenMeta(mint: string): Promise<JupiterTokenMeta | null> {
  if (!mint) return null;
  const apiKey = (process.env.JUPITER_API_KEY ?? "").trim();
  const host = apiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag";
  const headers: Record<string, string> = apiKey ? { "x-api-key": apiKey } : {};
  const timeoutMs = Number(process.env.JUPITER_HTTP_TIMEOUT_MS ?? 5000);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${host}/tokens/v2/search?query=${encodeURIComponent(mint)}`, {
      headers,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return null;
    // Find the exact-mint match (search may return related tokens too).
    const hit = arr.find((r) => {
      const id = String(r.id ?? r.mint ?? r.address ?? "");
      return id === mint;
    });
    if (!hit) return null;
    return {
      name: (hit.name as string | null) ?? null,
      symbol: (hit.symbol as string | null) ?? null,
      logoURI: (hit.icon as string | null) ?? (hit.logoURI as string | null) ?? null,
      usdPrice: pickNum(hit.usdPrice, hit.price),
      mcap: pickNum(hit.mcap, hit.marketCap),
      fdv: pickNum(hit.fdv),
      liquidityUsd: pickNum(hit.liquidity),
      volume24hUsd: pickNum((hit.stats24h as Record<string, unknown> | undefined)?.volume, hit.volume24h),
      holderCount: pickNum(hit.holderCount, hit.holders),
      organicScore: pickNum(hit.organicScore),
      verified: hit.isVerified === true,
    };
  } catch {
    return null;
  }
}

/**
 * Enriches non-Bags tokens (is_on_bags=false OR null) with Jupiter metadata.
 * Fills logo_url, token_name, token_ticker, current_price, current_mcap,
 * total_volume, holders, score (Jupiter-derived).
 */
async function refreshJupiterTokenMetadataOnce(): Promise<void> {
  const limit = Number(process.env.JUPITER_REFRESH_LIMIT ?? 50);

  // Pull tokens that are NOT on Bags (or unknown) — they need Jupiter metadata.
  const { data, error } = await supabase
    .from("narrative_tokens")
    .select("id, token_mint, token_name, token_ticker, logo_url, is_on_bags")
    .not("token_mint", "is", null)
    .or("is_on_bags.is.null,is_on_bags.eq.false")
    .limit(limit);

  if (error) {
    console.error("[jupiter-meta] select error:", error.message);
    return;
  }
  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    console.log("[jupiter-meta] no tokens to enrich");
    return;
  }

  let updated = 0;
  for (const row of rows) {
    try {
      const mint = normalizeTokenMintCandidate(row.token_mint);
      if (!isValidSolanaMintAddress(mint)) continue;

      const meta = await fetchJupiterTokenMeta(mint);
      if (!meta) {
        // Be polite — don't hammer Jupiter.
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Run the unified Scratch Score with whatever data Jupiter gave us.
      // For non-Bags tokens, lifecycle/socials/buyer-rank are absent — the
      // formula handles that and uses verified + organicScore as partial
      // substitutes (capped so Jupiter-only can't fake a perfect score).
      const jupScore = calculateScratchScore({
        mcap: meta.mcap ?? meta.fdv ?? 0,
        volume24h: meta.volume24hUsd ?? 0,
        liquidity: meta.liquidityUsd ?? 0,
        holders: meta.holderCount ?? 0,
        jupiterVerified: meta.verified === true,
        jupiterOrganicScore: meta.organicScore ?? undefined,
      });

      const patch: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (meta.logoURI && !row.logo_url) patch.logo_url = meta.logoURI;
      if (meta.name && !row.token_name) patch.token_name = meta.name;
      if (meta.symbol && !row.token_ticker) patch.token_ticker = meta.symbol;
      if (meta.usdPrice != null) patch.current_price = meta.usdPrice;
      if (meta.mcap != null) patch.current_mcap = meta.mcap;
      else if (meta.fdv != null) patch.current_mcap = meta.fdv;
      if (meta.volume24hUsd != null) patch.total_volume = meta.volume24hUsd;
      if (meta.liquidityUsd != null) patch.liquidity = meta.liquidityUsd;
      if (meta.holderCount != null) patch.holders = meta.holderCount;
      // Persist Jupiter quality signals so bags-refresh can apply them too
      // for tokens that exist on both sources.
      patch.jupiter_verified = meta.verified;
      if (meta.organicScore != null) patch.jupiter_organic_score = meta.organicScore;
      if (jupScore > 0) patch.score = jupScore;

      const { error: upErr } = await updateNarrativeTokenWithColumnFallback(String(row.id), patch, "jupiter-meta");
      if (upErr) {
        console.warn(`[jupiter-meta] update fail id=${row.id}:`, upErr.message);
      } else {
        updated++;
      }

      // Polite delay between Jupiter calls.
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.warn(
        `[jupiter-meta] fail mint=${row.token_mint}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  console.log(`[jupiter-meta] enriched=${updated}/${rows.length}`);
}

function startJupiterMetadataRefresher(): void {
  const intervalMs = Number(process.env.JUPITER_REFRESH_INTERVAL_MS ?? 600_000); // 10 min
  if (intervalMs <= 0) {
    console.log("[jupiter-meta] disabled (JUPITER_REFRESH_INTERVAL_MS<=0)");
    return;
  }
  console.log(`[jupiter-meta] enabled, interval=${Math.round(intervalMs / 1000)}s`);
  setTimeout(() => {
    void refreshJupiterTokenMetadataOnce();
    setInterval(() => void refreshJupiterTokenMetadataOnce(), intervalMs);
  }, 45_000);
}

app.post("/api/admin/jupiter/refresh-metadata", async (_req, res) => {
  await refreshJupiterTokenMetadataOnce();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[feed-api] listening on port ${PORT}`);
  startMetricsRefresher();
  startCleanupJob();
  startBagsRefresher();
  startJupiterMetadataRefresher();
  startFeedCacheRefresher();
});
