import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { getTokenMetaByMint, shortMint, SOL_MINT } from "../../lib/jupiter";
import { fetchTokenMetrics, type TokenMetrics } from "../../lib/api";

const METRICS_POLL_MS = 30_000;

function formatUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatUsdPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function scoreColor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#5DCAA5";
  if (s >= 40) return "#EF9F27";
  if (s >= 20) return "#71717A";
  return "#ef4444";
}

function stripTweetTypePrefix(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/^\[(tweet|repost|quote|comment)\]\s*/i, "");
}

export function TokenDetailPage() {
  const navigate = useNavigate();
  const { mint: mintParam } = useParams();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [metaName, setMetaName] = useState<string | null>(null);
  const [metaSymbol, setMetaSymbol] = useState<string | null>(null);
  const [metaLogo, setMetaLogo] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TokenMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const rawId = (mintParam ?? "").trim();
  const mint = useMemo(() => (rawId.toLowerCase() === "sol" ? SOL_MINT : rawId), [rawId]);

  useEffect(() => {
    let cancelled = false;
    if (!mint) return;
    void getTokenMetaByMint(mint).then((meta) => {
      if (cancelled || !meta) return;
      setMetaName(meta.name ?? null);
      setMetaSymbol(meta.symbol ?? null);
      setMetaLogo(meta.logoURI ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [mint]);

  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (initial: boolean): Promise<void> => {
      if (cancelled) return;
      if (initial) setMetricsLoading(true);
      try {
        const data = await fetchTokenMetrics(mint);
        if (cancelled) return;
        setMetrics(data);
        setMetricsError(null);
      } catch (e) {
        if (cancelled) return;
        setMetricsError(e instanceof Error ? e.message : "Failed to load metrics");
      } finally {
        if (!cancelled && initial) setMetricsLoading(false);
      }
    };

    void load(true);
    const schedule = (): void => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (!document.hidden) void load(false);
        schedule();
      }, METRICS_POLL_MS);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mint]);

  if (!rawId) {
    return (
      <div className="flex flex-col h-full bg-[#05070B]">
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-[#1a1f2e]/80">
          <button onClick={() => navigate(-1)} className="p-1 rounded-lg hover:bg-[#151a26] transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-sm font-bold text-white">Token Details</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#5a6078]">Token not found</p>
        </div>
      </div>
    );
  }

  const resolvedName = metrics?.tokenName || metaName || (mint ? `Token ${shortMint(mint)}` : "Token");
  const resolvedSymbol = metrics?.tokenTicker || metaSymbol || (mint ? mint.slice(0, 4).toUpperCase() : "TOKEN");
  const resolvedAddress = mint;
  const resolvedScore = metrics?.score ?? null;
  const resolvedMarketCap = formatUsdCompact(metrics?.marketCapUsd);
  const resolvedPrice = formatUsdPrice(metrics?.priceUsd);
  const resolvedVol24h = formatUsdCompact(metrics?.volume24hUsd);
  const resolvedLiquidity = formatUsdCompact(metrics?.liquidityUsd);
  const resolvedHolders = formatCount(metrics?.holders);
  const creator = metrics?.creator ?? null;
  const sourceTweet = metrics?.sourceTweet ?? null;
  const iconLetter = (resolvedSymbol || "T").slice(0, 1).toUpperCase();

  const handleCopyAddress = () => {
    const copy = () => {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(resolvedAddress).then(copy).catch(() => undefined);
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = resolvedAddress;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      copy();
    } finally {
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#05070B]">
      {/* Top Bar */}
      <div className="shrink-0 border-b border-[#1a1f2e]/80 bg-[#05070B]/80 backdrop-blur-xl z-20">
        <div className="max-w-[1280px] mx-auto flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} className="flex items-center justify-center w-10 h-10 rounded-full border border-[#1a1f2e] bg-[#0B0F17] transition-all hover:scale-110 hover:border-[#00FFA3]/50">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          
          {/* App Branding */}
          <div className="flex shrink-0 items-center gap-4 mr-2">
            <div className="flex items-center justify-center h-12 w-12 md:h-[54px] md:w-[54px]">
              <img src="/Delphi.svg" alt="Delphi Logo" className="h-full w-full object-contain" />
            </div>
            <span className="text-xl tracking-widest text-white mt-1" style={{ fontFamily: '"Press Start 2P", system-ui' }}>DELPHI</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase btn-font">
            {metricsLoading ? (
              <span className="flex items-center gap-1 text-[#5a6078]">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading
              </span>
            ) : metricsError ? (
              <span className="flex items-center gap-1 text-red-500" title={metricsError}>
                <AlertCircle className="w-3 h-3" />
                Offline
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[#00FFA3]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00FFA3] animate-pulse" />
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-6 md:py-8">
        <div className="max-w-2xl mx-auto">
          {/* Identity */}
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl md:text-5xl font-bold shadow-2xl overflow-hidden bg-gradient-to-br from-[#1a1f2e] to-[#0B0F17] border border-[#1a1f2e] text-white">
              {metrics?.logoUrl ? (
                <img src={metrics.logoUrl} alt={resolvedSymbol} className="w-full h-full object-cover" />
              ) : metaLogo ? (
                <img src={metaLogo} alt={resolvedSymbol} className="w-full h-full object-cover" />
              ) : sourceTweet?.imageUrl ? (
                <img src={sourceTweet.imageUrl} alt={resolvedSymbol} className="w-full h-full object-cover" />
              ) : (
                iconLetter
              )}
            </div>
          </div>

          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-2" style={{ fontFamily: '"Clash Display", sans-serif' }}>{resolvedName}</h2>
          <p className="text-lg md:text-xl text-[#8b92a8] text-center mb-2 btn-font tracking-widest uppercase">${resolvedSymbol}</p>

          {/* Badges */}
          <div className="flex items-center justify-center gap-2 mb-6 flex-wrap">
            {metrics?.isOnBags ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[#00FFA3]/15 text-[#00FFA3] border border-[#00FFA3]/30 px-2 py-1 rounded">On Bags</span>
            ) : null}
            {metrics?.launchedHere ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 px-2 py-1 rounded inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Launched on Delphi
              </span>
            ) : null}
            {metrics?.launchedAt ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[#151a26] text-[#8b92a8] border border-[#1a1f2e] px-2 py-1 rounded">
                {relativeTime(metrics.launchedAt)}
              </span>
            ) : null}
          </div>

          {/* Source tweet */}
          {sourceTweet?.id ? (
            <div className="mb-6 rounded-2xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4 md:p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078]">Source Tweet</span>
                {sourceTweet.postedAt ? (
                  <span className="text-[10px] text-[#5a6078]">{relativeTime(sourceTweet.postedAt)}</span>
                ) : null}
              </div>
              <div className="flex items-start gap-3">
                {creator?.avatarUrl ? (
                  <img src={creator.avatarUrl} alt={creator.handle ?? ""} className="w-10 h-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#151a26] border border-[#1a1f2e] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-white">
                      {(creator?.displayName ?? creator?.handle ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-white truncate">{creator?.displayName ?? creator?.handle ?? "Unknown"}</span>
                    {creator?.handle ? (
                      <span className="text-xs text-[#5a6078] truncate">@{creator.handle.replace(/^@/, "")}</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[#cfd6e8] leading-relaxed line-clamp-4 break-words">
                    {stripTweetTypePrefix(sourceTweet.content)}
                  </p>
                  {creator?.score != null ? (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#5a6078]">
                      <span>Creator score</span>
                      <span style={{ color: scoreColor(creator.score) }}>{Math.round(creator.score)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Stats */}
          <div className="rounded-2xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-5 md:p-6 mb-6">
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-2">Contract Address</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2.5 bg-[#05070B] border border-[#1a1f2e] rounded-lg">
                  <p className="text-xs md:text-sm text-white font-mono break-all">{resolvedAddress}</p>
                </div>
                <button onClick={handleCopyAddress} className="p-2.5 bg-[#05070B] border border-[#1a1f2e] rounded-lg hover:border-[#242b3d] transition-colors" title="Copy address">
                  {copiedAddress ? <Check className="w-5 h-5 text-[#00FFA3]" /> : <Copy className="w-5 h-5 text-[#8b92a8]" />}
                </button>
                <a
                  href={`https://solscan.io/token/${resolvedAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 bg-[#05070B] border border-[#1a1f2e] rounded-lg hover:border-[#242b3d] transition-colors"
                  title="View on Solscan"
                >
                  <ExternalLink className="w-5 h-5 text-[#8b92a8]" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Token Score" value={resolvedScore != null ? String(Math.round(resolvedScore)) : "—"} valueColor={scoreColor(resolvedScore)} />
              <StatCell label="Price" value={resolvedPrice} />
              <StatCell label="Market Cap" value={resolvedMarketCap} />
              <StatCell label="24h Volume" value={resolvedVol24h} />
              <StatCell label="Liquidity" value={resolvedLiquidity} />
              <StatCell label="Holders" value={resolvedHolders} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 md:gap-3">
            <div className="flex gap-2 md:gap-3">
              <a
                href={`https://jup.ag/swap/SOL-${resolvedAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-font flex-1 px-4 py-2.5 text-sm font-bold uppercase tracking-wider bg-[#00FFA3] text-black rounded-lg hover:bg-[#33ffb5] transition-all shadow-[0_4px_14px_0_rgba(0,255,163,0.3)] active:scale-95 text-center"
              >
                Buy on Jupiter
              </a>
              <a
                href={`https://jup.ag/swap/${resolvedAddress}-SOL`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-font flex-1 px-4 py-2.5 text-sm font-bold uppercase tracking-wider bg-[#1a1f2e] text-white border border-[#242b3d] rounded-lg hover:bg-[#242b3d] transition-all active:scale-95 text-center"
              >
                Sell on Jupiter
              </a>
            </div>
            {metrics?.isOnBags ? (
              <a
                href={`https://bags.fm/${resolvedAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-font px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-[#0B0F17] text-[#8b92a8] border border-[#1a1f2e] rounded-lg hover:bg-[#151a26] hover:text-white transition-all active:scale-95 text-center inline-flex items-center justify-center gap-1.5"
              >
                View on Bags <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="p-4 bg-[#05070B] border border-[#1a1f2e] rounded-xl">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-2">{label}</div>
      <div
        className="text-xl md:text-2xl font-bold text-white"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
