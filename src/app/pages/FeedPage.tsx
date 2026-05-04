import { useCallback, useEffect, useMemo, useState } from "react";
import { TweetCard } from "../components/TweetCard";
import { NavButtons } from "../components/NavButtons";
import type { TweetCardProps } from "../components/TweetCard";
import { TweetCardSkeleton } from "../components/TweetCardSkeleton";
import { MarketTerminal } from "../components/MarketTerminal";
import { Inbox, RefreshCw, TrendingUp, User } from "lucide-react";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedNarrative, setSelectedNarrative] = useState<string | null>(null);

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
    provider
      .connect({ onlyIfTrusted: true })
      .then(({ publicKey }) => {
        setWalletAddress(publicKey.toString());
      })
      .catch(() => {
        // Silent fail: user may not be connected yet.
      });
  }, []);

  const visibleTweets = tweets;

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

  const stats = useMemo(() => {
    const uniqueNarratives = new Set(tweets.map((t) => t.narrative));
    const tokensCount = tweets.reduce((acc, t) => acc + (t.tokens?.length ?? 0), 0);
    return {
      tracked: tweets.length,
      moving: tokensCount,
      venues: uniqueNarratives.size,
    };
  }, [tweets]);

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
          <span className="text-xl tracking-widest text-white mt-1" style={{ fontFamily: '"Press Start 2P", system-ui' }}>DELPHI</span>
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a1f2e] bg-[#0B0F17] transition-all hover:border-[#242b3d] hover:shadow-[0_0_10px_rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:w-9"
          title="Refresh feed"
        >
          <RefreshCw className={`h-4 w-4 text-[#8b92a8] ${isRefreshing ? "animate-spin" : ""}`} />
        </button>

        <NavButtons />

        {/* Spacer pushes wallet to right */}
        <div className="flex-1" />
        <div className="ml-auto flex items-center gap-2">
          {!walletAddress ? (
            <button
              type="button"
              onClick={() => void handleConnectWallet()}
              className="rounded-lg bg-[#00FFA3] px-3 py-1.5 text-xs font-bold text-black shadow-[0_0_15px_rgba(0,255,163,0.25)] transition-all hover:scale-105 hover:bg-[#33ffb5] hover:shadow-[0_0_20px_rgba(0,255,163,0.4)] md:px-4 md:py-2 md:text-sm"
            >
              Connect wallet
            </button>
          ) : (
            <>
              <div className="hidden items-center gap-1.5 rounded-lg border border-[#1a1f2e] bg-[#0B0F17] px-3 py-1.5 md:flex">
                <span className="text-xs text-[#5a6078]">Wallet:</span>
                <span className="text-sm font-bold text-white">{shortAddress(walletAddress)}</span>
              </div>
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

      {notice ? (
        <div className="shrink-0 border-b border-[#00d4ff]/30 bg-[#00d4ff]/10 px-4 py-2 text-sm text-[#00d4ff]">
          <span>{notice}</span>
          <button
            type="button"
            className="ml-2 font-semibold text-[#00d4ff] underline hover:text-white"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-[#f59e0b]/30 bg-[#f59e0b]/10 px-4 py-2 text-sm text-[#f59e0b]">
          <span>{error}</span>
          {" · "}
          <button type="button" className="font-bold underline" onClick={() => void loadFeed(filter)}>
            Retry
          </button>
          <span className="ml-2 text-[#f59e0b]/70">(Is the API running? Try </span>
          <code className="text-xs">npm run dev:server</code>
          <span className="text-[#f59e0b]/70">)</span>
        </div>
      ) : null}

      {/* Main content: centered container with max-width */}
      <div className="flex-1 min-h-0 flex justify-center">
        <div className="w-full max-w-[1280px] flex gap-6 p-4">
        {/* LEFT: Market Terminal — fixed width to prevent squishing */}
        <aside className="hidden md:flex md:flex-col w-[450px] shrink-0 h-full min-h-0">
          <MarketTerminal
            tweets={visibleTweets}
            narrative={selectedNarrative}
          />
        </aside>

        {/* RIGHT: Signal Feed (the only scrollable area) */}
        <div className="flex-1 min-w-0 overflow-y-auto no-scrollbar">
          <div className="flex flex-col gap-4">
            {/* Futuristic Header Card */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-5 relative overflow-hidden">
              {/* Subtle glow */}
              <div className="absolute top-0 right-0 w-48 h-48 bg-[#00FFA3]/5 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#00d4ff]/5 rounded-full blur-3xl pointer-events-none" />

              <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="flex-1">
                  <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-2 leading-tight" style={{ fontFamily: '"Clash Display", sans-serif' }}>
                    Turn <span className="text-[#00FFA3]">tweets</span> into <span className="text-[#00FFA3]">tokens</span>
                  </h1>
                  <p className="text-sm text-[#8b92a8] max-w-xl leading-relaxed">
                    Spot narratives before they blow up. Every post here is a potential market — select a tweet and launch it as a tradable token on Bags in seconds.
                  </p>

                  {/* Filter pills */}
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {(
                      [
                        ["all", "All"],
                        ["noTokens", "No tokens yet"],
                      ] as const
                    ).map(([key, label]) => {
                      const isActive = filter === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFilter(key)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                            isActive
                              ? "bg-[#00FFA3]/15 text-[#00FFA3] border border-[#00FFA3]/40 shadow-[0_0_10px_rgba(0,255,163,0.1)]"
                              : "bg-[#151a26] text-[#8b92a8] border border-[#1a1f2e] hover:border-[#242b3d] hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Stats Boxes */}
                <div className="flex gap-3 shrink-0">
                  <div className="rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 p-3 min-w-[80px]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1">Tracked</div>
                    <div className="text-xl font-bold text-white">{stats.tracked}</div>
                    <div className="text-[10px] text-[#5a6078] mt-0.5">signals in view</div>
                  </div>
                  <div className="rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 p-3 min-w-[80px]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1">Moving</div>
                    <div className="text-xl font-bold text-[#00FFA3]">{stats.moving}</div>
                    <div className="text-[10px] text-[#5a6078] mt-0.5">tokens active</div>
                  </div>
                  <div className="rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 p-3 min-w-[80px]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1">Narratives</div>
                    <div className="text-xl font-bold text-white">{stats.venues}</div>
                    <div className="text-[10px] text-[#5a6078] mt-0.5">categories</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tweets */}
            <div className="flex flex-col">
              {loading ? (
                <>
                  <TweetCardSkeleton />
                  <TweetCardSkeleton />
                  <TweetCardSkeleton />
                </>
              ) : visibleTweets.length === 0 && !error ? (
                <div className="mx-auto mt-8 max-w-md rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/60 px-6 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#151a26]">
                    <Inbox className="h-6 w-6 text-[#5a6078]" />
                  </div>
                  <p className="text-base font-bold text-white">No posts here yet</p>
                  <p className="mt-1 text-sm text-[#8b92a8]">
                    {tweets.length === 0
                      ? "New posts from tracked accounts will appear here automatically."
                      : "Try a different filter to see more posts."}
                  </p>
                </div>
              ) : (
                <div className="space-y-0">
                  {visibleTweets.map((tweet, index) => (
                    <TweetCard
                      key={tweet.tweetId ?? `${tweet.handle}-${tweet.time}-${index}`}
                      {...tweet}
                      onSelect={() => setSelectedNarrative(tweet.narrative)}
                      isSelected={selectedNarrative === tweet.narrative}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
}
