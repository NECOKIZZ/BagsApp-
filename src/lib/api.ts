/// <reference types="vite/client" />
import type { TweetCardProps } from "../app/components/TweetCard";

/**
 * Base URL for the backend API.
 * - In dev, leave VITE_API_BASE unset; Vite proxies `/api/*` to the local server.
 * - In production, set VITE_API_BASE to the deployed backend, e.g.
 *   `https://bagsapp-production.up.railway.app`.
 */
const API_BASE: string = (() => {
  const raw = (import.meta.env.VITE_API_BASE ?? "").toString().trim();
  return raw.replace(/\/$/, "");
})();

function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export type FeedFilter = "all" | "noTokens" | "highScore";

/**
 * Wire shape returned by GET /api/feed. Server uses snake_case for some fields
 * (tweet_id, image_url, link_preview) while the React component prefers
 * camelCase. Keep these in sync with server/index.ts:/api/feed.
 */
type ServerTweet = Omit<TweetCardProps, "tweetId" | "image" | "linkPreview"> & {
  tweetId?: string | null;
  tweet_id?: string | null;
  image_url?: string | null;
  image?: string | null;
  link_preview?: TweetCardProps["linkPreview"];
};

type FeedResponse = {
  tweets: ServerTweet[];
  filter: FeedFilter;
};

function feedUrl(filter: FeedFilter): string {
  const q = new URLSearchParams({ filter });
  return apiUrl(`/api/feed?${q}`);
}

export async function fetchFeed(filter: FeedFilter): Promise<TweetCardProps[]> {
  const res = await fetch(feedUrl(filter));
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }
  const data = (await res.json()) as FeedResponse;

  return data.tweets.map(
    ({ tweetId, tweet_id, image_url, image, link_preview, ...rest }): TweetCardProps => ({
      ...rest,
      // Support both camelCase and snake_case while backend transitions.
      tweetId: tweetId ?? tweet_id ?? null,
      image: image_url ?? image ?? undefined,
      linkPreview: link_preview ?? null,
    }),
  );
}

export interface TerminalToken {
  name: string;
  mint: string;
  score: number;
  time: string;
  createdAt: string;
  change24h: string;
  mcap: string;
  volume: string;
  returns: string;
  narrative?: string | null;
  logoUrl?: string | null;
}

export interface TerminalResponse {
  young: TerminalToken[];
  old: TerminalToken[];
  myApp: TerminalToken[];
}

export type TokenMetrics = {
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
};

/** Fetch live token metrics for a Solana mint (mcap, price, volume, etc). */
export async function fetchTokenMetrics(mint: string): Promise<TokenMetrics> {
  const res = await fetch(apiUrl(`/api/token/${encodeURIComponent(mint)}/metrics`));
  if (!res.ok) {
    throw new Error(`Token metrics request failed: ${res.status}`);
  }
  return res.json() as Promise<TokenMetrics>;
}

export async function fetchTerminalData(narrative?: string | null, tweetId?: string | null): Promise<TerminalResponse> {
  const q = new URLSearchParams();
  q.append("view", "terminal");
  if (tweetId) q.append("tweetId", tweetId);
  else if (narrative) q.append("narrative", narrative);
  
  const res = await fetch(apiUrl(`/api/feed?${q.toString()}`));
  if (!res.ok) {
    throw new Error(`Terminal request failed: ${res.status}`);
  }
  return res.json() as Promise<TerminalResponse>;
}

export type LaunchPayload = {
  narrative: string;
  name: string;
  ticker: string;
  liquiditySol: string;
  wallet?: string;
  imageUrl?: string;
  /** Source tweet id — enables linking launches back to the originating tweet. */
  tweetId?: string | null;
};

export type LaunchStartResponse = {
  launch: { id: string; status?: string; token_mint?: string | null; [key: string]: unknown };
  bags: null | {
    phase: "fee_share" | "launch";
    nextTransaction: string | null;
    mintUrl?: string;
  };
  message?: string;
};

export async function postLaunch(
  payload: LaunchPayload,
  opts?: { authToken?: string | null }
): Promise<LaunchStartResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.authToken) {
    headers.Authorization = `Bearer ${opts.authToken}`;
  }
  // Server expects snake_case `tweet_id`; translate before sending.
  const { tweetId, ...rest } = payload;
  const body = { ...rest, tweet_id: tweetId ?? null };
  const res = await fetch(apiUrl("/api/launches"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await buildApiError(res, `Launch failed: ${res.status}`);
  }
  return res.json() as Promise<LaunchStartResponse>;
}

/** Pull `error` + `hint` + `step` from a non-2xx server response into one Error. */
async function buildApiError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    hint?: string;
    step?: string;
  };
  const parts = [body.error ?? fallback];
  if (body.step) parts.push(`(step: ${body.step})`);
  if (body.hint) parts.push(`— ${body.hint}`);
  return new Error(parts.join(" "));
}

export type SubmitTxResponse = {
  ok: boolean;
  phase: "fee_share" | "launch" | "done";
  signature?: string;
  nextTransaction: string | null;
  pool?: unknown;
  mintUrl?: string;
};

export async function submitLaunchSignedTx(
  launchId: string,
  signedTransaction: string,
  opts?: { authToken?: string | null }
): Promise<SubmitTxResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.authToken) {
    headers.Authorization = `Bearer ${opts.authToken}`;
  }
  const res = await fetch(apiUrl(`/api/launches/${encodeURIComponent(launchId)}/submit-tx`), {
    method: "POST",
    headers,
    body: JSON.stringify({ signedTransaction }),
  });
  if (!res.ok) {
    throw await buildApiError(res, `Submit tx failed: ${res.status}`);
  }
  return res.json() as Promise<SubmitTxResponse>;
}

export type WalletNonceResponse = {
  nonce: string;
  message: string;
  expiresAt: number;
};

export async function requestWalletNonce(address: string): Promise<WalletNonceResponse> {
  const res = await fetch(apiUrl("/api/auth/nonce"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to create nonce");
  }
  return res.json();
}

export async function verifyWalletSignature(payload: {
  address: string;
  nonce: string;
  signature: string;
}): Promise<{ ok: true; address: string; token: string }> {
  const res = await fetch(apiUrl("/api/auth/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Wallet verification failed");
  }
  return res.json();
}

export async function checkWalletSession(token: string): Promise<{ ok: boolean; address?: string }> {
  const res = await fetch(apiUrl("/api/auth/session"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false };
  return res.json();
}

export async function logoutWalletSession(token: string): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
