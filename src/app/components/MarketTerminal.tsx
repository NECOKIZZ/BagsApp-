import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { TrendingUp, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { SwapModal } from "./SwapModal";
import type { TweetCardProps } from "./TweetCard";
import { fetchTerminalData, type TerminalToken, type TerminalResponse } from "../../lib/api";

interface MarketTerminalProps {
  tweets: TweetCardProps[];
  narrative?: string | null;
  tweetId?: string | null;
}

type TerminalTab = "OLD" | "YOUNG" | "MY APP";

export function MarketTerminal({ tweets, narrative, tweetId }: MarketTerminalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TerminalTab>("YOUNG");
  const [data, setData] = useState<TerminalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    const load = async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      try {
        const res = await fetchTerminalData(narrative, tweetId);
        setData(res);
      } catch (e) {
        console.error("Failed to load terminal data", e);
      } finally {
        if (!isBackground) setLoading(false);
        initialLoadDone.current = true;
      }
    };
    load(false);
    const id = setInterval(() => load(true), 30_000); // background refresh
    return () => clearInterval(id);
  }, [narrative, tweetId]);

  const activeTokens = useMemo(() => {
    if (!data) return [];
    if (activeTab === "OLD") return data.old ?? [];
    if (activeTab === "YOUNG") return data.young ?? [];
    return data.myApp ?? [];
  }, [data, activeTab]);

  // Smooth gradient: green at 100 → yellow at 50 → red at 0.
  // HSL hue 0=red, 60=yellow, 120=green; we map score linearly to that range.
  const scoreHue = (score: number) => Math.max(0, Math.min(120, (score / 100) * 120));
  const scoreHsl = (score: number, l = 55) => `hsl(${scoreHue(score)}, 80%, ${l}%)`;
  const scoreShadow = (score: number) => `0 0 6px hsla(${scoreHue(score)}, 80%, 55%, 0.55)`;

  // Returns a SVG asset path for the launch platform, or null if neither
  // pump.fun nor bags. We identify pump.fun via the vanity-suffix `pump`
  // baked into every pump-launched mint, and bags via either the explicit
  // `is_on_bags` flag or the (less common) `bags` vanity suffix.
  const platformIcon = (token: TerminalToken): { src: string; label: string } | null => {
    const mint = (token.mint ?? "").toLowerCase();
    if (token.isOnBags || mint.endsWith("bags")) {
      return { src: "/platforms/bags.svg", label: "Launched on bags" };
    }
    if (mint.endsWith("pump")) {
      return { src: "/platforms/pump.svg", label: "Launched on pump.fun" };
    }
    return null;
  };

  const getChangeColor = (change?: string | null) => {
    if (!change || typeof change !== "string") return "text-[#5a6078]";
    const trimmed = change.trim();
    if (trimmed.startsWith("-")) return "text-red-400";
    if (trimmed === "0%" || trimmed === "0.00%") return "text-[#5a6078]";
    return "text-[#00FFA3]";
  };

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm overflow-hidden relative">
      {/* Subtle corner glow */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-[#00FFA3]/5 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="shrink-0 bg-[#05070B]/90 backdrop-blur-md border-b border-[#1a1f2e] p-4 flex flex-col items-center">
        <h2 className="text-white text-sm md:text-base tracking-widest uppercase truncate" style={{ fontFamily: '"Press Start 2P", system-ui' }}>
          TERMINAL
        </h2>
      </div>

      {/* Tab Switcher */}
      <div className="shrink-0 flex p-1.5 gap-1 bg-[#05070B]/40 border-b border-[#1a1f2e]">
        {(["OLD", "YOUNG", "MY APP"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === tab
                ? "bg-[#00FFA3]/10 text-[#00FFA3] border border-[#00FFA3]/20 shadow-[0_0_10px_rgba(0,255,163,0.1)]"
                : "text-[#5a6078] hover:text-[#8b92a8] border border-transparent"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table Header */}
      <div className="shrink-0 flex items-center px-3 py-2 border-b border-[#1a1f2e]/60 bg-[#05070B]/50 text-[#5a6078] font-mono text-[10px] uppercase tracking-wider">
        <div className="flex-1 min-w-0">Token</div>
        <div className="w-12 text-right">Score</div>
        <div className="w-14 text-right hidden md:block">Time</div>
        <div className="w-14 text-right hidden md:block">24h%</div>
        <div className="w-14 text-right">Action</div>
      </div>

      {/* Token List */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-[#5a6078] text-xs animate-pulse">
            Syncing Terminal...
          </div>
        ) : activeTokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
            <div className="w-8 h-8 rounded-full bg-[#1a1f2e] flex items-center justify-center mb-3">
              <TrendingUp size={14} className="text-[#3a4058]" />
            </div>
            <p className="text-[#8b92a8] text-xs font-bold mb-1">
              No {activeTab.toLowerCase()} tokens available
            </p>
            <p className="text-[#5a6078] text-[10px]">
              {tweetId 
                ? "This post hasn't been linked to any tokens in this category yet." 
                : "Scanning the ecosystem for new narratives..."}
            </p>
          </div>
        ) : (
          activeTokens.map((token: TerminalToken) => (
            <div
              key={token.mint}
              className="group flex items-center w-full px-3 py-2 md:py-2.5 border-b border-[#1a1f2e]/40 last:border-0 hover:bg-[#00FFA3]/5 transition-all text-left"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {token.logoUrl ? (
                  <img src={token.logoUrl} className="w-5 h-5 rounded-full object-cover shrink-0 hidden md:block" alt={token.name} />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-[#1a1f2e] flex items-center justify-center text-[10px] text-[#5a6078] font-mono shrink-0 hidden md:block">
                    {(token.name || "??").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <button
                  onClick={() => navigate(`/token/${token.mint}`)}
                  className="font-mono font-bold text-xs md:text-sm truncate text-white hover:text-[#00FFA3] transition-colors min-w-0"
                >
                  {token.name || "???"}
                </button>
                {(() => {
                  const p = platformIcon(token);
                  if (!p) return null;
                  return (
                    <img
                      src={p.src}
                      alt={p.label}
                      title={p.label}
                      className="w-3.5 h-3.5 shrink-0 opacity-90 hidden md:block"
                    />
                  );
                })()}
              </div>

              <div className="flex items-center justify-end gap-1.5 w-12">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: scoreHsl(token.score), boxShadow: scoreShadow(token.score) }}
                />
                <span
                  className="font-mono text-xs font-bold"
                  style={{ color: scoreHsl(token.score) }}
                >
                  {token.score}
                </span>
              </div>

              <div className="font-mono text-[#8b92a8] text-[10px] w-14 text-right hidden md:block">
                {token.time}
              </div>

              <div className={`font-mono text-[10px] font-bold w-14 text-right hidden md:block ${getChangeColor(token.change24h)}`}>
                {token.change24h}
              </div>

              <div className="w-14 text-right">
                <SwapModal
                  inputMint="So11111111111111111111111111111111111111112"
                  outputMint={token.mint ?? undefined}
                  trigger={
                    <span className="btn-font inline-flex items-center justify-center px-3 py-1 rounded bg-[#00FFA3]/10 border border-[#00FFA3]/20 text-[#00FFA3] text-[10px] font-bold hover:bg-[#00FFA3] hover:text-black transition-all cursor-pointer">
                      BUY
                    </span>
                  }
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Terminal Footer */}
      <div className="shrink-0 bg-[#05070B]/80 border-t border-[#1a1f2e] px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00FFA3] animate-pulse" />
          <span className="text-[9px] font-mono text-[#5a6078] uppercase tracking-tighter">Live Narrative Sync</span>
        </div>
        <div className="text-[9px] font-mono text-[#3a4058]">
          V2.2.0-HI-FI
        </div>
      </div>
    </div>
  );
}
