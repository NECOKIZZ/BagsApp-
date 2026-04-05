import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { useState } from "react";

// Mock token data - in real app this would come from an API or state management
const mockTokenData: Record<string, any> = {
  "rwasolana": {
    id: "token_001",
    icon: "🌊",
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
  "blackrockfi": {
    id: "token_002",
    icon: "🏦",
    name: "BLACKROCKFI",
    ticker: "BRF",
    contractAddress: "9pKXzf3FW78d97TXJSDpbD5jBkheTqA83TZRuJosgBsX",
    score: 71,
    marketCap: "$890K",
    volume24h: "$215K",
    priceChange24h: 340.2,
    holders: "8.2K",
    liquidity: "$520K",
    iconColor: "#085041",
    iconBg: "#E1F5EE",
    creatorName: "ansem",
    creatorAddress: "@blknoiz06",
    creatorScore: 88,
  },
  "catalyst": {
    id: "token_003",
    icon: "⚡",
    name: "CATALYST",
    ticker: "CAT",
    contractAddress: "5mKXyh1GW87d97TXJSDpbD5jBkheTqA83TZRuJosgCsT",
    score: 44,
    marketCap: "$210K",
    volume24h: "$48K",
    priceChange24h: -22.0,
    holders: "3.1K",
    liquidity: "$125K",
    iconColor: "#712B13",
    iconBg: "#FAECE7",
    creatorName: "crypto_whale",
    creatorAddress: "@cryptowhale",
    creatorScore: 75,
  },
  "depingen": {
    id: "token_004",
    icon: "🔗",
    name: "DEPINGEN",
    ticker: "DPI",
    contractAddress: "3nKXvh2SW87d97TXJSDpbD5jBkheTqA83TZRuJosgDsW",
    score: 79,
    marketCap: "$560K",
    volume24h: "$180K",
    priceChange24h: 190.5,
    holders: "6.8K",
    liquidity: "$340K",
    iconColor: "#633806",
    iconBg: "#FAEEDA",
    creatorName: "kaito",
    creatorAddress: "@kaitoai",
    creatorScore: 85,
  },
  "gpunetwork": {
    id: "token_005",
    icon: "🖥️",
    name: "GPUNETWORK",
    ticker: "GPU",
    contractAddress: "8pKXwg3CW87d97TXJSDpbD5jBkheTqA83TZRuJosgEsV",
    score: 54,
    marketCap: "$142K",
    volume24h: "$35K",
    priceChange24h: 67.0,
    holders: "2.5K",
    liquidity: "$85K",
    iconColor: "#72243E",
    iconBg: "#FBEAF0",
    creatorName: "defi_builder",
    creatorAddress: "@defibuilder",
    creatorScore: 68,
  },
  "eigenlayer": {
    id: "token_006",
    icon: "🔺",
    name: "EIGENLAYER",
    ticker: "EGL",
    contractAddress: "6mKXth4DW87d97TXJSDpbD5jBkheTqA83TZRuJosgFsY",
    score: 83,
    marketCap: "$1.3M",
    volume24h: "$320K",
    priceChange24h: 520.0,
    holders: "10.2K",
    liquidity: "$680K",
    iconColor: "#3C3489",
    iconBg: "#EEEDFE",
    creatorName: "cobie",
    creatorAddress: "@cobie",
    creatorScore: 94,
  },
};

export function TokenDetailPage() {
  const navigate = useNavigate();
  const { tokenId } = useParams();
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Get token data based on tokenId
  const token = mockTokenData[tokenId?.toLowerCase() || ""];

  // If token not found, show error
  if (!token) {
    return (
      <div className="flex flex-col h-full bg-black">
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
          <button
            onClick={() => navigate(-1)}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
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

  const handleCopyAddress = () => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token.contractAddress)
        .then(() => {
          setCopiedAddress(true);
          setTimeout(() => setCopiedAddress(false), 2000);
        })
        .catch(() => {
          // Fallback to older method
          fallbackCopyTextToClipboard(token.contractAddress);
        });
    } else {
      // Use fallback for browsers without clipboard API
      fallbackCopyTextToClipboard(token.contractAddress);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand("copy");
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
    
    document.body.removeChild(textArea);
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <h1 className="text-sm font-bold text-gray-900">Token Details</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-6 md:py-8">
        <div className="max-w-2xl mx-auto">
          {/* Token Avatar */}
          <div className="flex justify-center mb-6">
            <div
              className="w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl md:text-5xl font-medium shadow-2xl"
              style={{
                backgroundColor: token.iconBg,
                color: token.iconColor,
              }}
            >
              {token.icon}
            </div>
          </div>

          {/* Token Name */}
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-2">
            {token.name}
          </h2>

          {/* Token Ticker */}
          <p className="text-lg md:text-xl text-gray-400 text-center mb-8">
            ${token.ticker}
          </p>

          {/* Creator Info Card */}
          <div className="relative mb-6">
            {/* Glow effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600/20 via-gray-400/20 to-gray-600/20 rounded-2xl blur-sm"></div>

            {/* Card */}
            <div className="relative bg-black border border-gray-700 rounded-2xl p-4 md:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500 mb-1 font-medium">
                    Created By
                  </div>
                  <div className="text-base md:text-lg font-bold text-white mb-0.5">
                    {token.creatorName}
                  </div>
                  <div className="text-xs md:text-sm text-gray-400">
                    {token.creatorAddress}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 mb-1 font-medium">
                    Creator Score
                  </div>
                  <div
                    className="text-2xl md:text-3xl font-bold"
                    style={{
                      color:
                        token.creatorScore >= 80
                          ? "#22c55e"
                          : token.creatorScore >= 60
                          ? "#f97316"
                          : "#ef4444",
                    }}
                  >
                    {token.creatorScore}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Info Card */}
          <div className="relative mb-6">
            {/* Glow effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600/20 via-gray-400/20 to-gray-600/20 rounded-2xl blur-sm"></div>

            {/* Card */}
            <div className="relative bg-black border border-gray-700 rounded-2xl p-5 md:p-6">
              {/* Contract Address */}
              <div className="mb-5">
                <div className="text-xs text-gray-500 mb-2 font-medium">
                  Contract Address
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-lg">
                    <p className="text-xs md:text-sm text-white font-mono break-all">
                      {token.contractAddress}
                    </p>
                  </div>
                  <button
                    onClick={handleCopyAddress}
                    className="p-2.5 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    {copiedAddress ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Copy className="w-5 h-5 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Token Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Token Score */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Token Score</div>
                  <div
                    className="text-2xl md:text-3xl font-bold"
                    style={{
                      color:
                        token.score >= 60
                          ? "#22c55e"
                          : token.score >= 25
                          ? "#f97316"
                          : "#ef4444",
                    }}
                  >
                    {token.score}
                  </div>
                </div>

                {/* Token ID */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Token ID</div>
                  <div className="text-2xl md:text-3xl font-bold text-white">
                    {token.id.split("_")[1]}
                  </div>
                </div>

                {/* Market Cap */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Market Cap</div>
                  <div className="text-xl md:text-2xl font-bold text-white">
                    {token.marketCap}
                  </div>
                </div>

                {/* 24h Volume */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">24h Volume</div>
                  <div className="text-xl md:text-2xl font-bold text-white">
                    {token.volume24h}
                  </div>
                </div>

                {/* 24h Price Change */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">24h Change</div>
                  <div
                    className={`text-xl md:text-2xl font-bold ${
                      token.priceChange24h >= 0
                        ? "text-green-500"
                        : "text-red-500"
                    }`}
                  >
                    {token.priceChange24h >= 0 ? "+" : ""}
                    {token.priceChange24h}%
                  </div>
                </div>

                {/* Holders */}
                <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Holders</div>
                  <div className="text-xl md:text-2xl font-bold text-white">
                    {token.holders}
                  </div>
                </div>

                {/* Liquidity */}
                <div className="col-span-2 p-4 bg-gray-900 border border-gray-800 rounded-xl">
                  <div className="text-xs text-gray-500 mb-2">Liquidity</div>
                  <div className="text-xl md:text-2xl font-bold text-white">
                    {token.liquidity}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 md:gap-4">
            <button className="flex-1 px-6 py-4 text-base md:text-lg font-bold bg-[#4ade80] text-white rounded-xl hover:bg-[#22c55e] transition-all shadow-[0_4px_14px_0_rgba(74,222,128,0.5)] hover:shadow-[0_6px_20px_rgba(74,222,128,0.7)] hover:scale-105 active:scale-95">
              Buy
            </button>
            <button className="flex-1 px-6 py-4 text-base md:text-lg font-bold bg-[#ef4444] text-white rounded-xl hover:bg-[#dc2626] transition-all shadow-[0_4px_14px_0_rgba(239,68,68,0.5)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.7)] hover:scale-105 active:scale-95">
              Sell
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}