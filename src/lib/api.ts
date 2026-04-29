import type { TweetCardProps } from "../app/components/TweetCard";

export type FeedFilter = "all" | "noTokens" | "highScore";

type FeedResponse = {
  tweets: TweetCardProps[];
  filter: FeedFilter;
};

function feedUrl(filter: FeedFilter): string {
  const q = new URLSearchParams({ filter });
  return `/api/feed?${q}`;
}

export async function fetchFeed(filter: FeedFilter): Promise<TweetCardProps[]> {
  const res = await fetch(feedUrl(filter));
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }
  const data = (await res.json()) as FeedResponse;
  return data.tweets;
}

export type LaunchPayload = {
  narrative: string;
  name: string;
  ticker: string;
  liquiditySol: string;
  wallet?: string;
  imageUrl?: string;
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
  const res = await fetch("/api/launches", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
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
  const res = await fetch(`/api/launches/${encodeURIComponent(launchId)}/submit-tx`, {
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
  const res = await fetch("/api/auth/nonce", {
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
  const res = await fetch("/api/auth/verify", {
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
  const res = await fetch("/api/auth/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false };
  return res.json();
}

export async function logoutWalletSession(token: string): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
