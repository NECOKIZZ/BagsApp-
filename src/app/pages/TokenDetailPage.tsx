import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { getTokenMetaByMint, shortMint, SOL_MINT } from "../../lib/jupiter";
import { fetchTokenMetrics } from "../../lib/api";

const METRICS_POLL_MS = 30_000;

type TokenViewModel = {
  id: string;
  icon: string;
  name: string;
  ticker: string;
  contractAddress: string;
  score: number;
  marketCap: string;
  volume24h: string;
  priceChange24h: number;
  holders: string;
  liquidity: string;
  iconColor: string;
  iconBg: string;
  creatorName: string;
  creatorAddress: string;
  creatorScore: number;
  logoURI?: string;
};

type LiveMetrics = {
  marketCapUsd: number | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  score: number | null;
};

const mockTokenData: Record<string, Partial<TokenViewModel>> = {
  rwasolana: {
    id: "token_001",
    icon: "T",
    name: "RWASOLANA",
    ticker: "RWAS",
    contractAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    score: 88,
    marketCap: "$2.1M",
    volume24h: "$450K",
    priceChange24h: 840.5,
    holders: "12.5K",
    liquidity: "$890K",
    iconColor: "#3C3489",
    iconBg: "#EEEDFE",
    creatorName: "Murad",
    creatorAddress: "@murad_m",
    creatorScore: 92,
  },
};

function defaultTokenFromId(tokenId: string): TokenViewModel {
  const upper = tokenId.slice(0, 6).toUpperCase();
  return {
    id: `token_${tokenId.slice(0, 6)}`,
    icon: upper.slice(0, 1) || "T",
    name: `Token ${shortMint(tokenId)}`,
    ticker: upper.slice(0, 4) || "TOKEN",
    contractAddress: tokenId,
    score: 0,
    marketCap: "N/A",
    volume24h: "N/A",
    priceChange24h: 0,
    holders: "N/A",
    liquidity: "N/A",
    iconColor: "#3C3489",
    iconBg: "#EEEDFE",
    creatorName: "Unknown",
    creatorAddress: "@unknown",
    creatorScore: 0,
  };
}

export function TokenDetailPage() {
  const navigate = useNavigate();
  const { tokenId } = useParams();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [metaName, setMetaName] = useState<string | null>(null);
  const [metaSymbol, setMetaSymbol] = useState<string | null>(null);
  const [metaLogo, setMetaLogo] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const rawId = (tokenId ?? "").trim();

  const token = useMemo(() => {
    const bySlug = mockTokenData[rawId.toLowerCase()];
    const base = bySlug ? ({ ...defaultTokenFromId(bySlug.contractAddress ?? rawId), ...bySlug } as TokenViewModel) : defaultTokenFromId(rawId);
    return base;
  }, [rawId]);

  useEffect(() => {
    let cancelled = false;
    if (!rawId) return;
    const mint = rawId.toLowerCase() === "sol" ? SOL_MINT : rawId;
    void getTokenMetaByMint(mint).then((meta) => {
      if (cancelled || !meta) return;
      setMetaName(meta.name ?? null);
      setMetaSymbol(meta.symbol ?? null);
      setMetaLogo(meta.logoURI ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [rawId]);

  useEffect(() => {
    if (!rawId) return;
    const mint = rawId.toLowerCase() === "sol" ? SOL_MINT : rawId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (initial: boolean): Promise<void> => {
      if (cancelled) return;
      if (initial) setMetricsLoading(true);
      try {
        const data = await fetchTokenMetrics(mint);
        if (cancelled) return;
        setMetrics({
          marketCapUsd: data.marketCapUsd,
          priceUsd: data.priceUsd,
          volume24hUsd: data.volume24hUsd,
          liquidityUsd: data.liquidityUsd,
          holders: data.holders,
          score: data.score,
        });
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
  }, [rawId]);

  if (!rawId) {
    return (
      <div className="flex flex-col h-full bg-black">
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-900" />
          </button>
          <h1 className="text-sm font-bold text-gray-900">Token Details</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400">Token not found</p>
        </div>
      </div>
    );
  }

  const resolvedName = metaName ?? token.name;
  const resolvedSymbol = metaSymbol ?? token.ticker;
  const resolvedAddress = token.contractAddress || rawId;
  const resolvedScore = metrics?.score ?? token.score;
  const resolvedMarketCap = metrics?.marketCapUsd != null ? `$${metrics.marketCapUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : token.marketCap;
  const resolvedVol24h = metrics?.volume24hUsd != null ? `$${metrics.volume24hUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : token.volume24h;
  const resolvedLiquidity = metrics?.liquidityUsd != null ? `$${metrics.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : token.liquidity;
  const resolvedHolders = metrics?.holders != null ? metrics.holders.toLocaleString("en-US") : token.holders;

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
          <div className="flex justify-center mb-6">
            <div
              className="w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl md:text-5xl font-medium shadow-2xl overflow-hidden"
              style={{ backgroundColor: token.iconBg, color: token.iconColor }}
            >
              {metaLogo ? <img src={metaLogo} alt={resolvedSymbol} className="w-full h-full object-cover" /> : token.icon}
            </div>
          </div>

          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-2" style={{ fontFamily: '"Clash Display", sans-serif' }}>{resolvedName}</h2>
          <p className="text-lg md:text-xl text-gray-400 text-center mb-8 btn-font tracking-widest uppercase">${resolvedSymbol}</p>

          <div className="relative mb-6">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600/20 via-gray-400/20 to-gray-600/20 rounded-2xl blur-sm"></div>
            <div className="relative bg-black border border-gray-700 rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500 mb-1 font-medium">Created By</div>
                  <div className="text-base md:text-lg font-bold text-white mb-0.5">{token.creatorName}</div>
                  <div className="text-xs md:text-sm text-gray-400">{token.creatorAddress}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 mb-1 font-medium">Creator Score</div>
                  <div className="text-2xl md:text-3xl font-bold" style={{ color: token.creatorScore >= 80 ? "#22c55e" : token.creatorScore >= 60 ? "#f97316" : "#ef4444" }}>
                    {token.creatorScore}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative mb-6">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600/20 via-gray-400/20 to-gray-600/20 rounded-2xl blur-sm"></div>
            <div className="relative bg-black border border-gray-700 rounded-2xl p-5 md:p-6">
              <div className="mb-5">
                <div className="text-xs text-gray-500 mb-2 font-medium">Contract Address</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-lg">
                    <p className="text-xs md:text-sm text-white font-mono break-all">{resolvedAddress}</p>
                  </div>
                  <button onClick={handleCopyAddress} className="p-2.5 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors">
                    {copiedAddress ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Token Score</div>
                  <div className="text-2xl md:text-3xl font-bold" style={{ color: resolvedScore >= 60 ? "#22c55e" : resolvedScore >= 25 ? "#f97316" : "#ef4444" }}>
                    {resolvedScore}
                  </div>
                </div>

                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Token ID</div>
                  <div className="text-2xl md:text-3xl font-bold text-white">{token.id.replace("token_", "")}</div>
                </div>

                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Market Cap</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{resolvedMarketCap}</div>
                </div>

                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">24h Volume</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{resolvedVol24h}</div>
                </div>

                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">24h Change</div>
                  <div className={`text-xl md:text-2xl font-bold ${token.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {token.priceChange24h >= 0 ? "+" : ""}
                    {token.priceChange24h}%
                  </div>
                </div>

                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Holders</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{resolvedHolders}</div>
                </div>

                <div className="col-span-2 p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Liquidity</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{resolvedLiquidity}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 md:gap-3">
            <button className="btn-font flex-1 px-4 py-2 text-sm font-bold bg-[#00FFA3] text-black rounded-lg hover:bg-[#33ffb5] transition-all shadow-[0_4px_14px_0_rgba(0,255,163,0.3)] active:scale-95">Buy</button>
            <button className="btn-font flex-1 px-4 py-2 text-sm font-bold bg-[#ef4444] text-white rounded-lg hover:bg-[#dc2626] transition-all shadow-[0_4px_14px_0_rgba(239,68,68,0.3)] active:scale-95">Sell</button>
          </div>
        </div>
      </div>
    </div>
  );
}
