import { useNavigate } from "react-router";
import { Loader2, User, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavButtons } from "../components/NavButtons";
import {
  checkWalletSession,
  requestWalletNonce,
  verifyWalletSignature,
  logoutWalletSession,
} from "../../lib/api";
import { getPhantom, hasAnySolanaWallet, shortAddress } from "../../lib/phantom";
import { fetchJupiterTokenMap, getTokenMetaSync, shortMint, SOL_MINT, type TokenMeta } from "../../lib/jupiter";

const SOLANA_RPC =
  (import.meta.env.VITE_SOLANA_RPC as string | undefined)?.trim() ||
  "https://api.mainnet-beta.solana.com";
const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
const SOLANA_RPC_FALLBACKS = [
  SOLANA_RPC,
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];
// Jupiter API key is OPTIONAL. Without one, hit the free lite host. With one, hit pro.
const JUPITER_API_KEY = (import.meta.env.VITE_JUPITER_API_KEY as string | undefined)?.trim() || "";
const JUPITER_HOST = JUPITER_API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
const JUPITER_PRICE_API = `${JUPITER_HOST}/price/v2`;
const JUPITER_PRICE_V3_API = `${JUPITER_HOST}/price/v3`;
interface TokenHolding {
  mint: string;
  name: string;
  symbol: string;
  amount: number;
  value: number;
  logo?: string;
  decimals: number;
}

async function fetchSolBalanceAtRpc(address: string, rpcUrl: string): Promise<number> {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address, { commitment: "confirmed" }],
    }),
  });
  if (!r.ok) {
    throw new Error(`RPC getBalance HTTP ${r.status} (${rpcUrl})`);
  }
  const j = (await r.json()) as { result?: { value?: number }; error?: { message?: string } };
  if (j.error) {
    throw new Error(`${j.error.message ?? "RPC getBalance failed"} (${rpcUrl})`);
  }
  const lamports = Number(j.result?.value ?? 0);
  if (!Number.isFinite(lamports)) {
    throw new Error(`RPC getBalance returned invalid value (${rpcUrl})`);
  }
  return lamports / 1e9;
}

async function fetchSolBalance(address: string): Promise<{ balance: number; rpcUsed: string }> {
  const errors: string[] = [];
  const uniqueRpcs = [...new Set(SOLANA_RPC_FALLBACKS.filter(Boolean))];
  for (const rpc of uniqueRpcs) {
    try {
      const balance = await fetchSolBalanceAtRpc(address, rpc);
      return { balance, rpcUsed: rpc };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.join(" | "));
}

async function fetchTokenAccounts(address: string) {
  const r = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
    }),
  });
  const j = await r.json();
  return (j.result?.value ?? []) as Array<{
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            tokenAmount: { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string };
          };
        };
      };
    };
  }>;
}

function jupiterHeaders(): HeadersInit {
  return JUPITER_API_KEY ? { "x-api-key": JUPITER_API_KEY } : {};
}

async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const batches: string[][] = [];
  for (let i = 0; i < mints.length; i += 100) batches.push(mints.slice(i, i + 100));
  const results: Record<string, number> = {};

  const readV2 = (payload: unknown, mint: string): number | null => {
    const root = payload as { data?: Record<string, { price?: number | string }> };
    const raw = root?.data?.[mint]?.price;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const readV3 = (payload: unknown, mint: string): number | null => {
    const root = payload as Record<string, { usdPrice?: number | string }>;
    const raw = root?.[mint]?.usdPrice;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  for (const batch of batches) {
    const ids = batch.join(",");
    try {
      const v2Resp = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`, { headers: jupiterHeaders() });
      if (v2Resp.ok) {
        const j = await v2Resp.json();
        for (const mint of batch) {
          const v = readV2(j, mint);
          if (v != null) results[mint] = v;
        }
      } else {
        console.warn(`[jupiter] price v2 HTTP ${v2Resp.status} for ${batch.length} mints`);
      }

      const unresolved = batch.filter((mint) => results[mint] == null);
      if (unresolved.length > 0) {
        const v3Ids = unresolved.join(",");
        const v3Resp = await fetch(`${JUPITER_PRICE_V3_API}?ids=${v3Ids}`, { headers: jupiterHeaders() });
        if (v3Resp.ok) {
          const j3 = await v3Resp.json();
          for (const mint of unresolved) {
            const v = readV3(j3, mint);
            if (v != null) results[mint] = v;
          }
        } else {
          console.warn(`[jupiter] price v3 HTTP ${v3Resp.status} for ${unresolved.length} mints`);
        }
      }
    } catch (e) {
      console.warn("[jupiter] price fetch failed:", e);
    }
  }
  return results;
}

export function ProfilePage() {
  const navigate = useNavigate();
  const [isCopied, setIsCopied] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPrice, setSolPrice] = useState<number>(0);
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceHint, setBalanceHint] = useState<string | null>(null);
  const [activeRpc, setActiveRpc] = useState<string>(SOLANA_RPC);
  const [tokenMetaMap, setTokenMetaMap] = useState<Map<string, TokenMeta>>(new Map());

  // Restore wallet session
  useEffect(() => {
    const token = localStorage.getItem("walletAuthToken");
    const address = localStorage.getItem("walletAddress");
    if (token && address) {
      void checkWalletSession(token)
        .then((session) => {
          if (session.ok && session.address === address) {
            setAuthToken(token);
            setWalletAddress(address);
          } else {
            localStorage.removeItem("walletAuthToken");
            localStorage.removeItem("walletAddress");
          }
          setLoading(false);
        })
        .catch(() => {
          localStorage.removeItem("walletAuthToken");
          localStorage.removeItem("walletAddress");
          setLoading(false);
        });
      return;
    }
    // No stored session — try silent reconnect via Phantom
    const provider = getPhantom();
    if (provider) {
      provider
        .connect({ onlyIfTrusted: true })
        .then(({ publicKey }) => {
          setWalletAddress(publicKey.toString());
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Fetch Jupiter token list once
  useEffect(() => {
    void fetchJupiterTokenMap().then((map) => setTokenMetaMap(new Map(map)));
  }, []);

  // Fetch SOL balance + price
  useEffect(() => {
    if (!walletAddress) { setSolBalance(null); setBalanceHint(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [bal, prices] = await Promise.all([
          fetchSolBalance(walletAddress),
          fetchJupiterPrices([SOL_MINT]),
        ]);
        if (!cancelled) {
          setSolBalance(bal.balance);
          setActiveRpc(bal.rpcUsed);
          setSolPrice(prices[SOL_MINT] ?? 0);
          if (bal.balance > 0) {
            setBalanceHint(null);
            return;
          }
          try {
            const devnetBal = await fetchSolBalanceAtRpc(walletAddress, SOLANA_DEVNET_RPC);
            if (!cancelled && devnetBal > 0) {
              setBalanceHint(
                `This wallet has ${devnetBal.toFixed(4)} SOL on devnet. Portfolio is reading mainnet (${bal.rpcUsed}).`,
              );
            } else if (!cancelled) {
              setBalanceHint(null);
            }
          } catch {
            if (!cancelled) setBalanceHint(null);
          }
        }
      } catch {
        if (!cancelled) {
          setSolBalance(null);
          setBalanceHint("Could not read SOL balance from any RPC endpoint. This is usually an RPC/network block issue.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress, tokenMetaMap]);

  // Fetch token accounts + prices — independent of token metadata so balances render even if Jupiter is down
  useEffect(() => {
    if (!walletAddress) {
      setHoldings([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const accounts = await fetchTokenAccounts(walletAddress);
        const raw = accounts
          .map((a) => {
            const info = a.account.data.parsed.info;
            return {
              mint: info.mint,
              amount: info.tokenAmount.uiAmount ?? Number(info.tokenAmount.uiAmountString) ?? 0,
              decimals: info.tokenAmount.decimals,
            };
          })
          .filter((t) => t.amount > 0);
        const mints = raw.map((t) => t.mint);
        const prices = await fetchJupiterPrices(mints);
        const data: TokenHolding[] = raw
          .map((t) => {
            const price = prices[t.mint] ?? 0;
            const meta = getTokenMetaSync(t.mint, tokenMetaMap);
            return {
              mint: t.mint,
              name: meta?.name ?? `Token ${shortMint(t.mint)}`,
              symbol: meta?.symbol ?? t.mint.slice(0, 4),
              amount: t.amount,
              value: t.amount * price,
              logo: meta?.logoURI,
              decimals: t.decimals,
            };
          })
          .sort((a, b) => b.value - a.value);
        if (!cancelled) setHoldings(data);
      } catch (e) {
        console.warn("[portfolio] holdings fetch failed:", e);
        if (!cancelled) setHoldings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress, tokenMetaMap]);

  // Enrich holdings with Jupiter metadata when the map becomes available
  useEffect(() => {
    if (tokenMetaMap.size === 0) return;
    setHoldings((prev) =>
      prev.map((h) => {
        const meta = tokenMetaMap.get(h.mint);
        if (!meta) return h;
        return {
          ...h,
          name: meta.name ?? h.name,
          symbol: meta.symbol ?? h.symbol,
          logo: meta.logoURI ?? h.logo,
        };
      }),
    );
  }, [tokenMetaMap]);

  const totalValue = useMemo(() => {
    const solVal = (solBalance ?? 0) * solPrice;
    return solVal + holdings.reduce((sum, h) => sum + h.value, 0);
  }, [solBalance, solPrice, holdings]);

  const handleCopyAddress = useCallback(() => {
    if (!walletAddress) return;
    navigator.clipboard?.writeText(walletAddress);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [walletAddress, tokenMetaMap]);

  const handleConnectWallet = async () => {
    const provider = getPhantom();
    if (!provider) {
      alert(hasAnySolanaWallet() ? "Use Phantom wallet" : "Install Phantom wallet");
      return;
    }
    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();
      setWalletAddress(address);
      localStorage.setItem("walletAddress", address);

      if (!provider.signMessage) {
        alert("This wallet does not support signMessage.");
        return;
      }
      const { nonce, message } = await requestWalletNonce(address);
      const encodedMessage = new TextEncoder().encode(message);
      const signed = await provider.signMessage(encodedMessage, "utf8");
      const signatureB64 = btoa(String.fromCharCode(...signed.signature));
      const verified = await verifyWalletSignature({ address, nonce, signature: signatureB64 });
      setAuthToken(verified.token);
      localStorage.setItem("walletAuthToken", verified.token);
      localStorage.setItem("walletAddress", verified.address);
    } catch (e) {
      console.error("[wallet] connect error:", e);
      alert(e instanceof Error ? e.message : "Wallet connection failed.");
    }
  };

  const handleDisconnectWallet = async () => {
    const provider = getPhantom();
    try {
      if (authToken) await logoutWalletSession(authToken);
      await provider?.disconnect();
    } finally {
      setAuthToken(null);
      setWalletAddress(null);
      setSolBalance(null);
      setBalanceHint(null);
      setHoldings([]);
      localStorage.removeItem("walletAddress");
      localStorage.removeItem("walletAuthToken");
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Top Bar */}
      <div className="shrink-0 border-b border-[#1a1f2e]/80 bg-[#05070B]/80 backdrop-blur-xl z-20">
        <div className="max-w-[1280px] mx-auto flex items-center gap-3 px-4 py-4">
        {/* App Branding */}
        <div className="flex shrink-0 items-center gap-4 mr-2">
          <div className="flex items-center justify-center h-12 w-12 md:h-[54px] md:w-[54px]">
            <img src="/Delphi.svg" alt="Delphi Logo" className="h-full w-full object-contain" />
          </div>
          <span className="hidden md:block text-xl tracking-widest mt-1" style={{ fontFamily: '"Press Start 2P", system-ui' }}><span className="text-white">DEL</span><span className="text-[#00FFA3]">PHI</span></span>
        </div>
        
        <NavButtons />
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {!walletAddress ? (
            <button
              type="button"
              onClick={() => void handleConnectWallet()}
              className="rounded-lg bg-[#00FFA3] px-3 py-1.5 text-xs font-bold text-black shadow-[0_0_15px_rgba(0,255,163,0.25)] transition-all hover:scale-105 hover:bg-[#33ffb5] hover:shadow-[0_0_20px_rgba(0,255,163,0.4)] md:px-4 md:py-2 md:text-sm"
            >
              Connect<span className="hidden md:inline"> wallet</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyAddress}
                title={isCopied ? "Copied!" : "Copy address"}
                className="hidden items-center gap-1.5 rounded-lg border border-[#1a1f2e] bg-[#0B0F17] px-3 py-1.5 md:flex hover:border-[#242b3d] transition-colors"
              >
                <span className="text-xs text-[#5a6078]">Wallet:</span>
                <span className="text-sm font-bold text-white font-mono">{shortAddress(walletAddress)}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectWallet()}
                className="rounded-lg border border-[#1a1f2e] bg-[#0B0F17] px-3 py-1.5 text-xs font-bold text-[#8b92a8] transition-colors hover:bg-[#151a26] hover:text-white md:px-4 md:py-2 md:text-sm"
                title="Disconnect wallet"
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectWallet()}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#1a1f2e] bg-[#0B0F17] transition-all hover:scale-110 hover:border-[#00FFA3]/50 hover:shadow-[0_0_10px_rgba(0,255,163,0.2)] md:h-9 md:w-9"
                title="Disconnect wallet"
              >
                <User className="h-4 w-4 text-[#8b92a8] md:h-5 md:w-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>

      {isCopied && (
        <div className="shrink-0 border-b border-[#00FFA3]/30 bg-[#00FFA3]/10 px-4 py-2 text-sm text-[#00FFA3]">
          Wallet address copied!
        </div>
      )}
      {balanceHint && (
        <div className="shrink-0 border-b border-[#f59e0b]/30 bg-[#f59e0b]/10 px-4 py-2 text-sm text-[#f59e0b]">
          {balanceHint}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Balance Card */}
          <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#5a6078] mb-1">Total Value</div>
                <div className="text-3xl font-bold text-white tracking-tight">
                  {walletAddress ? (
                    loading && holdings.length === 0 ? (
                      <span className="flex items-center gap-2 text-xl text-[#5a6078]">
                        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                      </span>
                    ) : (
                      `$${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    )
                  ) : (
                    <span className="text-xl text-[#5a6078]">—</span>
                  )}
                </div>
                {walletAddress && solBalance !== null && (
                  <div className="text-[11px] text-[#5a6078] mt-1">
                    {solBalance.toFixed(4)} SOL @ ${solPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    <span className="ml-2 opacity-80">(RPC: {activeRpc})</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Tokens held */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5a6078] mb-2">Tokens held</div>
              <div className="font-mono text-3xl font-bold text-white tabular-nums tracking-tight">
                {walletAddress
                  ? holdings.length + (solBalance && solBalance > 0 ? 1 : 0)
                  : "—"}
              </div>
            </div>

            {/* Score */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5a6078] mb-2">Score</div>
              <div className="font-mono text-3xl font-bold text-[#00FFA3] tabular-nums tracking-tight">
                —<span className="text-[#5a6078]">/100</span>
              </div>
            </div>

            {/* PNL */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5a6078] mb-2">PNL</div>
              <div className="font-mono text-3xl font-bold text-[#00FFA3] tabular-nums tracking-tight">
                $0.00
              </div>
            </div>

            {/* Tokens created */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5a6078] mb-2">Tokens created</div>
              <div className="font-mono text-3xl font-bold text-red-400 tabular-nums tracking-tight">
                0
              </div>
            </div>
          </div>

          {/* Holdings Section */}
          <div className="pt-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#5a6078] mb-3">Your Tokens</h2>
            {!walletAddress && (
              <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 p-6 text-center">
                <Wallet className="h-8 w-8 text-[#5a6078] mx-auto mb-3" />
                <p className="text-sm text-[#5a6078] mb-3">Connect your wallet to view portfolio</p>
                <button
                  onClick={handleConnectWallet}
                  className="bg-[#00FFA3] hover:bg-[#33ffb5] text-black font-bold rounded-lg px-4 py-2 text-xs transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            )}
            {walletAddress && loading && holdings.length === 0 && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 text-[#00FFA3] animate-spin" />
              </div>
            )}
            {walletAddress && !loading && holdings.length === 0 && (!solBalance || solBalance === 0) && (
              <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 p-6 text-center text-sm text-[#5a6078]">
                No tokens found in this wallet.
              </div>
            )}
            {walletAddress && (
              <div className="space-y-2">
                {/* SOL row */}
                {solBalance !== null && solBalance > 0 && (
                  <div key={SOL_MINT} className="rounded-lg border border-[#1a1f2e] bg-[#0B0F17]/80 p-2.5 hover:border-[#242b3d] transition-all">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 bg-[#1a1f2e]">
                        {getTokenMetaSync(SOL_MINT, tokenMetaMap)?.logoURI ? (<img src={getTokenMetaSync(SOL_MINT, tokenMetaMap)?.logoURI} alt="SOL" className="w-6 h-6 rounded-full" />) : (<span className="text-xs">S</span>)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`/token/${SOL_MINT}`)}
                            className="text-sm font-bold text-white hover:text-[#00FFA3] transition-colors truncate"
                          >{getTokenMetaSync(SOL_MINT, tokenMetaMap)?.name ?? "Wrapped SOL"}</button>
                          <span className="text-[10px] text-[#5a6078]">{getTokenMetaSync(SOL_MINT, tokenMetaMap)?.symbol ?? "SOL"}</span>
                        </div>
                        <div className="text-[11px] text-[#5a6078]">{solBalance.toFixed(4)}</div>
                      </div>
                      <div className="text-right mr-1">
                        <div className="text-sm font-bold text-white">
                          ${((solBalance ?? 0) * solPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <a
                        role="button"
                        href="https://jup.ag/swap/SOL-USDC"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border border-[#00FFA3]/40 text-[#00FFA3] hover:bg-[#00FFA3] hover:text-black hover:shadow-[0_0_12px_rgba(0,255,163,0.3)] rounded-md px-2.5 py-1 text-[10px] transition-all"
                      >
                        Trade
                      </a>
                    </div>
                  </div>
                )}
                {holdings.map((holding) => (
                  <div key={holding.mint} className="rounded-lg border border-[#1a1f2e] bg-[#0B0F17]/80 p-2.5 hover:border-[#242b3d] transition-all">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 bg-[#1a1f2e]">
                        {holding.logo ? (
                          <img src={holding.logo} alt={holding.symbol} className="w-6 h-6 rounded-full" />
                        ) : (
                          <span className="text-xs">🪙</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`/token/${holding.mint}`)}
                            className="text-sm font-bold text-white hover:text-[#00FFA3] transition-colors truncate"
                          >
                            {holding.name}
                          </button>
                          <span className="text-[10px] text-[#5a6078]">{holding.symbol}</span>
                        </div>
                        <div className="text-[11px] text-[#5a6078]">
                          {holding.amount.toLocaleString(undefined, { maximumFractionDigits: holding.decimals > 4 ? 2 : holding.decimals })}
                        </div>
                      </div>
                      <div className="text-right mr-1">
                        <div className="text-sm font-bold text-white">
                          {holding.value >= 0.01
                            ? `$${holding.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "<$0.01"}
                        </div>
                      </div>
                      <a
                        role="button"
                        href={`https://jup.ag/swap/SOL-${holding.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border border-[#00FFA3]/40 text-[#00FFA3] hover:bg-[#00FFA3] hover:text-black hover:shadow-[0_0_12px_rgba(0,255,163,0.3)] rounded-md px-2.5 py-1 text-[10px] transition-all"
                      >
                        Trade
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}




