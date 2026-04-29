import { useCallback, useEffect, useState } from "react";
import { TweetCard } from "../components/TweetCard";
import type { TweetCardProps } from "../components/TweetCard";
import { ChevronDown, RefreshCw, User } from "lucide-react";
import {
  checkWalletSession,
  fetchFeed,
  logoutWalletSession,
  requestWalletNonce,
  type FeedFilter,
  verifyWalletSignature,
} from "../../lib/api";
import { getPhantom, hasAnySolanaWallet, shortAddress } from "../../lib/phantom";

export function FeedPage() {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [tweets, setTweets] = useState<TweetCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Non-error notices (e.g. 201 launch saved without Bags) — not the red/amber feed error bar */
  const [notice, setNotice] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadFeed = useCallback(async (nextFilter: FeedFilter, opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setError(null);
      setNotice(null);
      setLoading(true);
    }
    try {
      const data = await fetchFeed(nextFilter);
      setTweets(data);
      if (opts?.silent) setError(null);
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Could not load feed");
        setTweets([]);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed(filter);
  }, [filter, loadFeed]);

  // Silent auto-refresh every 30s. Pauses when tab not visible to save API quota.
  useEffect(() => {
    const POLL_MS = 30_000;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadFeed(filter, { silent: true });
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [filter, loadFeed]);

  useEffect(() => {
    const provider = getPhantom();
    const token = localStorage.getItem("walletAuthToken");
    const address = localStorage.getItem("walletAddress");

    if (token && address) {
      void checkWalletSession(token)
        .then((session) => {
          if (session.ok && session.address === address) {
            setAuthToken(token);
            setWalletAddress(address);
            return;
          }
          localStorage.removeItem("walletAuthToken");
          localStorage.removeItem("walletAddress");
        })
        .catch(() => {
          localStorage.removeItem("walletAuthToken");
          localStorage.removeItem("walletAddress");
        });
      return;
    }

    if (!provider) return;
    provider.connect({ onlyIfTrusted: true }).catch(() => {
      // Silent fail: user may not be connected yet.
    });
  }, []);

  const filterLabel =
    filter === "all" ? "All" : filter === "noTokens" ? "No tokens yet" : "High score";

  const handleRefresh = () => {
    setIsRefreshing(true);
    void loadFeed(filter);
  };

  const handleConnectWallet = async () => {
    console.log("[wallet] connect button clicked");
    setError(null);
    try {
      const provider = getPhantom();
      console.log("[wallet] provider detected:", provider ? "yes" : "no", {
        hasAny: hasAnySolanaWallet(),
        win: typeof window !== "undefined" ? Object.keys(window).filter((k) => /sol|phant/i.test(k)) : [],
      });
      if (!provider) {
        setError(
          hasAnySolanaWallet()
            ? "A Solana wallet was detected but isn't compatible (we use Phantom). Open Phantom directly or install it from phantom.app."
            : "No Solana wallet found. Install Phantom (phantom.app) and refresh this tab.",
        );
        return;
      }

      console.log("[wallet] calling provider.connect()…");
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();
      console.log("[wallet] connected:", address);

      if (!provider.signMessage) {
        throw new Error("This wallet does not support signMessage.");
      }

      console.log("[wallet] requesting nonce…");
      const { nonce, message } = await requestWalletNonce(address);
      const encodedMessage = new TextEncoder().encode(message);
      console.log("[wallet] signing message…");
      const signed = await provider.signMessage(encodedMessage, "utf8");
      const signatureB64 = btoa(String.fromCharCode(...signed.signature));

      console.log("[wallet] verifying signature on server…");
      const verified = await verifyWalletSignature({ address, nonce, signature: signatureB64 });
      console.log("[wallet] verified, session token issued");

      setWalletAddress(verified.address);
      setAuthToken(verified.token);
      localStorage.setItem("walletAddress", verified.address);
      localStorage.setItem("walletAuthToken", verified.token);
    } catch (e) {
      console.error("[wallet] connect error:", e);
      const code = (e as { code?: number })?.code;
      const msg =
        code === 4001
          ? "Connection rejected in wallet."
          : e instanceof Error
          ? e.message
          : "Wallet connection failed.";
      setError(msg);
    }
  };

  const handleDisconnectWallet = async () => {
    const provider = getPhantom();
    try {
      if (authToken) {
        await logoutWalletSession(authToken);
      }
      await provider?.disconnect();
    } finally {
      setAuthToken(null);
      setWalletAddress(null);
      localStorage.removeItem("walletAddress");
      localStorage.removeItem("walletAuthToken");
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-black px-4 py-3">
        <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
          <span className="text-xs font-semibold text-white">LIVE</span>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 transition-all hover:scale-110 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:w-9"
          title="Refresh feed"
        >
          <RefreshCw className={`h-4 w-4 text-white ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all md:px-4 md:text-sm ${
              filter !== "all"
                ? "bg-white text-black shadow-[0_4px_14px_0_rgba(255,255,255,0.35)]"
                : "border border-zinc-800 bg-zinc-900 text-zinc-400"
            }`}
          >
            {filterLabel}
            <ChevronDown className={`h-4 w-4 transition-transform ${isFilterOpen ? "rotate-180" : ""}`} />
          </button>
          {isFilterOpen ? (
            <div className="absolute left-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl">
              {(
                [
                  ["all", "All"],
                  ["noTokens", "No tokens yet"],
                  ["highScore", "High score"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFilter(key);
                    setIsFilterOpen(false);
                  }}
                  className={`w-full px-4 py-3 text-left text-sm font-bold transition-all ${
                    filter === key ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!walletAddress ? (
            <button
              type="button"
              onClick={() => void handleConnectWallet()}
              className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-black shadow-[0_4px_14px_0_rgba(255,255,255,0.35)] transition-all hover:scale-105 hover:bg-zinc-100 md:px-4 md:py-2 md:text-sm"
            >
              Connect wallet
            </button>
          ) : (
            <>
              <div className="hidden items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 md:flex">
                <span className="text-xs text-zinc-400">Wallet:</span>
                <span className="text-sm font-bold text-white">{shortAddress(walletAddress)}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleDisconnectWallet()}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-800 md:px-4 md:py-2 md:text-sm"
                title="Disconnect wallet"
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnectWallet()}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-zinc-700 bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg transition-all hover:scale-110 md:h-9 md:w-9"
                title="Disconnect wallet"
              >
                <User className="h-4 w-4 text-white md:h-5 md:w-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {notice ? (
        <div className="shrink-0 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100">
          <span>{notice}</span>
          <button
            type="button"
            className="ml-2 font-semibold text-sky-300 underline hover:text-white"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          <span>{error}</span>
          {" · "}
          <button type="button" className="font-bold underline" onClick={() => void loadFeed(filter)}>
            Retry
          </button>
          <span className="ml-2 text-amber-200/70">(Is the API running? Try </span>
          <code className="text-xs">npm run dev:server</code>
          <span className="text-amber-200/70">)</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-6">
        {loading ? (
          <p className="text-center text-sm text-zinc-500">Loading feed…</p>
        ) : tweets.length === 0 && !error ? (
          <div className="mx-auto max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-8 text-center">
            <p className="text-sm text-zinc-400">No posts match this filter.</p>
          </div>
        ) : (
          tweets.map((tweet, index) => (
            <TweetCard
              key={`${tweet.handle}-${tweet.time}`}
              {...tweet}
              initiallyExpanded={index === 0}
              /* Tokenize button now routes to /tokenize page (no modal). */
            />
          ))
        )}
      </div>
    </div>
  );
}
