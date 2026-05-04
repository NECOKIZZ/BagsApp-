const DEFAULT_BASE = "https://public-api-v2.bags.fm/api/v1";

function normalizeApiKey(raw: string | undefined): string {
  let k = raw?.trim() ?? "";
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

export function getBagsConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.BAGS_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const apiKey = normalizeApiKey(process.env.BAGS_API_KEY);
  return { baseUrl, apiKey };
}

export function bagsConfigured(): boolean {
  return Boolean(getBagsConfig().apiKey);
}

export function bagsHttpDebugEnabled(): boolean {
  const v = process.env.LOG_BAGS_HTTP?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function bagsHttpLog(method: string, path: string, extra?: string) {
  if (bagsHttpDebugEnabled()) {
    console.log(`[bags-http] ${method} ${path}${extra ? ` ${extra}` : ""}`);
  }
}

type BagsErrorBody = { success?: boolean; error?: string };

export class BagsApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "BagsApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function bagsJson<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { baseUrl, apiKey } = getBagsConfig();
  if (!apiKey) {
    throw new BagsApiError("BAGS_API_KEY is not set", 503, {});
  }

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    ...(init.headers as Record<string, string> | undefined),
  };

  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  bagsHttpLog(init.method ?? "GET", path);
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, body });
  const data = (await parseJson(res)) as BagsErrorBody & { response?: unknown; success?: boolean };

  if (!res.ok || data.success === false) {
    console.error(
      `[bags-http] ERROR ${init.method ?? "GET"} ${path} status=${res.status} body=`,
      JSON.stringify(data).slice(0, 1500),
    );
    const msg = extractBagsErrorMessage(data, res.status);
    throw new BagsApiError(msg, res.status, data);
  }

  return data as T;
}

/**
 * Bags is inconsistent about where it puts error text. Sometimes it's in
 * `error`, sometimes it's `response: "Internal server error"`. We also
 * append actionable hints for common 500 causes so the UI can show them.
 */
function extractBagsErrorMessage(
  data: BagsErrorBody & { response?: unknown },
  status: number,
): string {
  if (typeof data.error === "string" && data.error.length > 0) return data.error;
  if (typeof data.response === "string" && data.response.length > 0) {
    return `Bags: ${data.response} (HTTP ${status})`;
  }
  return `Bags API error (${status})`;
}

export type CreateTokenInfoResult = {
  success: true;
  response: {
    tokenMint: string;
    tokenMetadata: string;
    tokenLaunch: Record<string, unknown>;
  };
};

export async function bagsCreateTokenInfo(params: {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
}): Promise<CreateTokenInfoResult> {
  const { baseUrl, apiKey } = getBagsConfig();
  if (!apiKey) {
    throw new BagsApiError("BAGS_API_KEY is not set", 503, {});
  }

  const form = new FormData();
  form.append("name", params.name);
  form.append("symbol", params.symbol);
  form.append("description", params.description);
  form.append("imageUrl", params.imageUrl);

  bagsHttpLog("POST", "/token-launch/create-token-info", "(multipart)");
  const res = await fetch(`${baseUrl}/token-launch/create-token-info`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });

  const data = (await parseJson(res)) as CreateTokenInfoResult & BagsErrorBody & { response?: unknown };
  if (!res.ok || (data as { success?: boolean }).success === false) {
    console.error(
      `[bags-http] ERROR POST /token-launch/create-token-info status=${res.status} body=`,
      JSON.stringify(data).slice(0, 1500),
    );
    const msg = extractBagsErrorMessage(data, res.status);
    throw new BagsApiError(msg, res.status, data);
  }

  return data as CreateTokenInfoResult;
}

export type TxWithBlockhash = {
  blockhash: { blockhash: string; lastValidBlockHeight: number };
  transaction: string;
};

export type FeeShareConfigResponse = {
  success: true;
  response: {
    needsCreation: boolean;
    feeShareAuthority: string;
    meteoraConfigKey: string;
    transactions: TxWithBlockhash[] | null;
    bundles: TxWithBlockhash[][] | null;
  };
};

export async function bagsCreateFeeShareConfig(body: {
  payer: string;
  baseMint: string;
  claimersArray: string[];
  basisPointsArray: number[];
}): Promise<FeeShareConfigResponse> {
  return bagsJson<FeeShareConfigResponse>("/fee-share/config", { method: "POST", json: body });
}

export async function bagsSendTransaction(signedTransactionBase58: string): Promise<{ response: string }> {
  const data = await bagsJson<{ success: true; response: string }>("/solana/send-transaction", {
    method: "POST",
    json: { transaction: signedTransactionBase58 },
  });
  return data;
}

export async function bagsCreateLaunchTransaction(body: {
  ipfs: string;
  tokenMint: string;
  wallet: string;
  initialBuyLamports: number;
  configKey: string;
}): Promise<{ success: true; response: string }> {
  return bagsJson<{ success: true; response: string }>("/token-launch/create-launch-transaction", {
    method: "POST",
    json: body,
  });
}

export async function bagsGetPoolByMint(tokenMint: string): Promise<unknown> {
  const q = new URLSearchParams({ tokenMint });
  return bagsJson<unknown>(`/solana/bags/pools/token-mint?${q}`, { method: "GET" });
}

/** Pool record returned by GET /solana/bags/pools (per Bags docs). */
export type BagsPoolInfo = {
  tokenMint: string;
  dbcConfigKey: string;
  dbcPoolKey: string;
  dammV2PoolKey?: string | null;
};

/**
 * List all Bags pools. Bags has no name/keyword search endpoint — this is the
 * authoritative way to know which mints exist on the platform.
 *
 * The response is mint-only (no metadata); callers must combine this with a
 * metadata source like Jupiter to get token names/symbols.
 */
export async function bagsListAllPools(opts: { onlyMigrated?: boolean } = {}): Promise<BagsPoolInfo[]> {
  try {
    const q = new URLSearchParams();
    if (opts.onlyMigrated) q.set("onlyMigrated", "true");
    const path = `/solana/bags/pools${q.toString() ? `?${q}` : ""}`;
    const data = await bagsJson<{ success: boolean; response?: BagsPoolInfo[] }>(path, {
      method: "GET",
    });
    return Array.isArray(data.response) ? data.response : [];
  } catch (e) {
    console.error("[bags-list-pools] failed:", e);
    return [];
  }
}

export type BagsAuthPingResult = {
  requested: boolean;
  httpStatus: number;
  authOk: boolean;
  bagsError?: string;
  interpretation: string;
};

/** Lightweight GET to Bags — 200 means the API key is accepted; 401 means invalid key. */
export async function bagsPingAuth(): Promise<BagsAuthPingResult> {
  const { baseUrl, apiKey } = getBagsConfig();
  if (!apiKey) {
    return {
      requested: false,
      httpStatus: 0,
      authOk: false,
      interpretation:
        "No BAGS_API_KEY in the API process after loading .env. Fix .env next to package.json, then restart npm run dev:server (or dev:all).",
    };
  }

  try {
    bagsHttpLog("GET", "/solana/bags/pools", "(auth ping)");
    const res = await fetch(`${baseUrl}/solana/bags/pools`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    const body = (await parseJson(res)) as BagsErrorBody;
    const bagsError = typeof body.error === "string" ? body.error : undefined;

    if (res.status === 401 || res.status === 403) {
      return {
        requested: true,
        httpStatus: res.status,
        authOk: false,
        bagsError,
        interpretation:
          "Bags returned 401/403 — the key is missing, wrong, or revoked. Create a new key in the Bags developer portal and update BAGS_API_KEY.",
      };
    }

    if (res.status === 200) {
      return {
        requested: true,
        httpStatus: res.status,
        authOk: true,
        interpretation:
          "Bags accepted your API key. If token launch still fails, check Phantom wallet, SOL balance, and any error text after create-token-info in the terminal (enable LOG_BAGS_HTTP=true).",
      };
    }

    if (res.status >= 500) {
      return {
        requested: true,
        httpStatus: res.status,
        authOk: false,
        bagsError,
        interpretation: "Bags server error — try again later. Your request reached Bags; the problem is on their side or overload.",
      };
    }

    return {
      requested: true,
      httpStatus: res.status,
      authOk: false,
      bagsError,
      interpretation: `Unexpected HTTP ${res.status}. See bagsError if present.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      requested: true,
      httpStatus: 0,
      authOk: false,
      interpretation: `Could not reach Bags (${msg}). Check network, firewall, or BAGS_API_BASE_URL.`,
    };
  }
}
