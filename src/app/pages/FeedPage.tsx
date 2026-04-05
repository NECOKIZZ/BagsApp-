import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";
import { TweetCard } from "../components/TweetCard";
import { TokenizeModal } from "../components/feed/TokenizeModal";
import type { TweetCardProps } from "../components/TweetCard";
import { ChevronDown, RefreshCw, Rocket, User } from "lucide-react";
import {
  checkWalletSession,
  fetchFeed,
  logoutWalletSession,
  postLaunch,
  requestWalletNonce,
  submitLaunchSignedTx,
  type FeedFilter,
  verifyWalletSignature,
} from "../../lib/api";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  disconnect: () => Promise<void>;
};

const getPhantom = (): PhantomProvider | null => {
  const provider = (window as Window & { solana?: PhantomProvider }).solana;
  return provider?.isPhantom ? provider : null;
};

const shortAddress = (address: string): string =>
  `${address.slice(0, 4)}...${address.slice(-4)}`;

/** Dev / optional prod: show demo card + “Test Bags launch” without relying on the API dummy row */
const showTestLaunchUi =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_TEST_LAUNCH === "true";

const DEMO_FEED_HANDLE = "@demo_feed_preview";

const BAGS_TEST_MODAL = {
  narrative:
    "Test Bags launch from the UI — use this to verify token metadata, fee-share transactions, and Phantom signing. Replace with real narrative data when your feed is live.",
  suggestedName: "TEST",
} as const;

const DEV_DEMO_TWEET: TweetCardProps = {
  avatar: "DM",
  avatarColor: "#7dd3a0",
  name: "Demo preview (local)",
  handle: DEMO_FEED_HANDLE,
  time: "Preview",
  tweet:
    "This card only appears in dev (or when VITE_SHOW_TEST_LAUNCH=true). Use Tokenize below, or the “Test Bags launch” button in the header.",
  keywords: ["Bags", "demo", "test"],
  likes: "0",
  retweets: "0",
  views: "0",
  narrative: BAGS_TEST_MODAL.narrative,
  tokens: [],
};

function mergeWithDevDemo(tweets: TweetCardProps[]): TweetCardProps[] {
  if (!showTestLaunchUi) return tweets;
  if (tweets.some((t) => t.handle === DEMO_FEED_HANDLE)) return tweets;
  return [DEV_DEMO_TWEET, ...tweets];
}

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
  const [modal, setModal] = useState<{ narrative: string; suggestedName: string } | null>(null);
  const userBalance = 12450.75;

  const loadFeed = useCallback(async (nextFilter: FeedFilter) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const data = await fetchFeed(nextFilter);
      setTweets(mergeWithDevDemo(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load feed");
      setTweets([]);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed(filter);
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
    const provider = getPhantom();
    if (!provider) {
      setError("Phantom wallet not found. Install Phantom and refresh.");
      return;
    }
    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();

      if (!provider.signMessage) {
        throw new Error("Phantom does not support signMessage in this context.");
      }

      const { nonce, message } = await requestWalletNonce(address);
      const encodedMessage = new TextEncoder().encode(message);
      const signed = await provider.signMessage(encodedMessage, "utf8");
      const signatureB64 = btoa(String.fromCharCode(...signed.signature));

      const verified = await verifyWalletSignature({
        address,
        nonce,
        signature: signatureB64,
      });

      setWalletAddress(verified.address);
      setAuthToken(verified.token);
      localStorage.setItem("walletAddress", verified.address);
      localStorage.setItem("walletAuthToken", verified.token);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
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
        {showTestLaunchUi ? (
          <button
            type="button"
            onClick={() =>
              setModal({ narrative: BAGS_TEST_MODAL.narrative, suggestedName: BAGS_TEST_MODAL.suggestedName })
            }
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500/20 md:gap-2 md:px-3 md:py-2 md:text-sm"
            title="Open token launch modal (Bags test)"
          >
            <Rocket className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span className="hidden sm:inline">Test Bags launch</span>
            <span className="sm:hidden">Test</span>
          </button>
        ) : null}
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
            {filter === "highScore" ? (
              <p className="mt-2 text-xs text-zinc-600">
                The dev demo card has no scored tokens, so switch to <span className="text-zinc-400">All</span> or{" "}
                <span className="text-zinc-400">No tokens yet</span>.
              </p>
            ) : null}
            {showTestLaunchUi ? (
              <button
                type="button"
                onClick={() =>
                  setModal({
                    narrative: BAGS_TEST_MODAL.narrative,
                    suggestedName: BAGS_TEST_MODAL.suggestedName,
                  })
                }
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_0_rgba(16,185,129,0.45)] transition-all hover:bg-emerald-600"
              >
                <Rocket className="h-4 w-4" />
                Test Bags launch
              </button>
            ) : null}
          </div>
        ) : (
          tweets.map((tweet, index) => (
            <TweetCard
              key={`${tweet.handle}-${tweet.time}`}
              {...tweet}
              initiallyExpanded={index === 0}
              onTokenize={(narrative, suggestedName) => setModal({ narrative, suggestedName })}
            />
          ))
        )}
      </div>
      <TokenizeModal
        open={modal !== null}
        narrative={modal?.narrative ?? ""}
        suggestedName={modal?.suggestedName ?? ""}
        onClose={() => setModal(null)}
        onLaunch={async (payload) => {
          if (!modal) return;
          const provider = getPhantom();
          if (!provider?.publicKey) {
            setError("Connect your Solana wallet before launching on Bags.");
            return;
          }
          if (!provider.signTransaction) {
            setError("This wallet cannot sign Solana transactions here.");
            return;
          }
          setError(null);
          setNotice(null);
          try {
            const wallet = provider.publicKey.toString();
            const start = await postLaunch(
              {
                narrative: modal.narrative,
                name: payload.name,
                ticker: payload.ticker,
                liquiditySol: payload.liquiditySol,
                wallet,
              },
              { authToken }
            );

            if (!start.bags) {
              setModal(null);
              if (start.message) {
                setNotice(start.message);
              }
              return;
            }

            let next: string | null = start.bags.nextTransaction;
            if (!next) {
              setError("Bags did not return a transaction to sign.");
              return;
            }

            while (next) {
              const vtx = VersionedTransaction.deserialize(bs58.decode(next));
              const signed = await provider.signTransaction(vtx);
              const signedB58 = bs58.encode(signed.serialize());
              const step = await submitLaunchSignedTx(start.launch.id, signedB58, { authToken });
              if (step.phase === "done") {
                setModal(null);
                return;
              }
              next = step.nextTransaction;
              if (!next) {
                setError("Launch flow ended without a final signature.");
                return;
              }
            }

            setModal(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Launch request failed");
          }
        }}
      />
    </div>
  );
}
