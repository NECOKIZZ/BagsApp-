import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import type { TweetCardProps } from "./TweetCard";

interface MarketTerminalProps {
  tweets: TweetCardProps[];
  narrative?: string | null;
}

export function MarketTerminal({ tweets, narrative }: MarketTerminalProps) {

  const tokens = useMemo(() => {
    const map = new Map<string, NonNullable<TweetCardProps["tokens"]>[number]>();
    for (const tweet of tweets) {
      if (narrative && tweet.narrative !== narrative) continue;
      for (const token of tweet.tokens ?? []) {
        if (!map.has(token.name)) {
          map.set(token.name, token);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  }, [tweets, narrative]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-[#00FFA3]";
    if (score >= 50) return "text-[#00d4ff]";
    return "text-[#5a6078]";
  };

  const getScoreDot = (score: number) => {
    if (score >= 80) return "bg-[#00FFA3] shadow-[0_0_6px_rgba(0,255,163,0.6)]";
    if (score >= 50) return "bg-[#00d4ff] shadow-[0_0_6px_rgba(0,212,255,0.5)]";
    return "bg-[#5a6078]";
  };

  const getReturnsColor = (returns: string) => {
    const trimmed = returns.trim();
    if (trimmed.startsWith("-")) return "text-red-400";
    return "text-[#00FFA3]";
  };

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm overflow-hidden relative">
      {/* Subtle corner glow */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-[#00FFA3]/5 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="shrink-0 bg-[#05070B]/90 backdrop-blur-md border-b border-[#1a1f2e] p-3 flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[#00FFA3]/10 border border-[#00FFA3]/20">
          <TrendingUp size={14} className="text-[#00FFA3]" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-white text-base tracking-tight truncate">
            {narrative ? "Top 10 Tokens" : "Market Terminal"}
          </h2>
        </div>
      </div>

      {/* Table Header */}
      <div className="shrink-0 flex items-center px-3 py-2 border-b border-[#1a1f2e]/60 bg-[#05070B]/50 text-[#5a6078] font-mono text-[10px] uppercase tracking-wider">
        <div className="w-20">Token</div>
        <div className="w-14">Score</div>
        <div className="w-20 text-right">Mcap</div>
        <div className="w-20 text-right hidden lg:block">Vol(24h)</div>
        <div className="w-16 text-right">Ret</div>
        <div className="flex-1 text-right">Action</div>
      </div>

      {/* Token List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tokens.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[#5a6078] text-xs">
            No tokens detected
          </div>
        ) : (
          tokens.map((token) => (
            <div
              key={token.name}
              className="group flex items-center px-3 py-2.5 border-b border-[#1a1f2e]/40 last:border-0 hover:bg-[#00FFA3]/5 transition-all"
            >
              <div className="font-mono font-bold text-sm w-20 truncate text-white">
                {token.name}
              </div>

              <div className="flex items-center gap-1.5 w-14">
                <div className={`w-1.5 h-1.5 rounded-full ${getScoreDot(token.score)}`} />
                <span className={`font-mono text-xs font-bold ${getScoreColor(token.score)}`}>
                  {token.score}
                </span>
              </div>

              <div className="font-mono text-[#8b92a8] text-xs w-20 text-right">
                {token.marketCap}
              </div>

              <div className="font-mono text-[#5a6078] text-xs w-20 text-right hidden lg:block">
                {token.volume ?? "—"}
              </div>

              <div className={`font-mono text-xs font-bold w-16 text-right ${getReturnsColor(token.returns)}`}>
                {token.returns}
              </div>

              <div className="flex-1 text-right">
                {token.mint ? (
                  <a
                    role="button"
                    href={`https://jup.ag/swap/SOL-${token.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 border border-[#00FFA3]/40 text-[#00FFA3] rounded-md transition-all hover:bg-[#00FFA3] hover:text-black hover:shadow-[0_0_15px_rgba(0,255,163,0.3)] text-[10px] px-2.5 py-1"
                  >
                    Trade
                  </a>
                ) : (
                  <button
                    disabled
                    className="border border-[#1a1f2e] text-[#5a6078] rounded-md font-medium text-[10px] px-2.5 py-1 cursor-not-allowed"
                  >
                    Trade
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
