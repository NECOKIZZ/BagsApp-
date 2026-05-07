import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";

interface TokenHolding {
  id: number;
  icon: string;
  name: string;
  ticker: string;
  amount: number;
  value: number;
  priceChange: number;
  iconColor: string;
  iconBg: string;
}

export function TokensHeldPage() {
  const navigate = useNavigate();
  
  // Mock data - sorted by value from highest to lowest
  const [holdings] = useState<TokenHolding[]>([
    {
      id: 1,
      icon: "🌊",
      name: "RWASOLANA",
      ticker: "RWAS",
      amount: 1250000,
      value: 4850.50,
      priceChange: 840.5,
      iconColor: "#3C3489",
      iconBg: "#EEEDFE",
    },
    {
      id: 2,
      icon: "🚀",
      name: "MOONSHOT",
      ticker: "MOON",
      amount: 500000,
      value: 2340.75,
      priceChange: 125.3,
      iconColor: "#085041",
      iconBg: "#E1F5EE",
    },
    {
      id: 3,
      icon: "💎",
      name: "DIAMOND",
      ticker: "DIAM",
      amount: 750000,
      value: 1890.25,
      priceChange: -15.2,
      iconColor: "#712B13",
      iconBg: "#FAECE7",
    },
    {
      id: 4,
      icon: "🔥",
      name: "HOTFIRE",
      ticker: "FIRE",
      amount: 320000,
      value: 1250.00,
      priceChange: 67.8,
      iconColor: "#633806",
      iconBg: "#FAEEDA",
    },
    {
      id: 5,
      icon: "⚡",
      name: "LIGHTNING",
      ticker: "BOLT",
      amount: 180000,
      value: 890.50,
      priceChange: -8.4,
      iconColor: "#72243E",
      iconBg: "#FBEAF0",
    },
    {
      id: 6,
      icon: "🌟",
      name: "STARLIGHT",
      ticker: "STAR",
      amount: 425000,
      value: 675.30,
      priceChange: 32.1,
      iconColor: "#3C3489",
      iconBg: "#EEEDFE",
    },
    {
      id: 7,
      icon: "🎯",
      name: "BULLSEYE",
      ticker: "BULL",
      amount: 95000,
      value: 412.80,
      priceChange: -22.5,
      iconColor: "#085041",
      iconBg: "#E1F5EE",
    },
    {
      id: 8,
      icon: "🌈",
      name: "RAINBOW",
      ticker: "RAIN",
      amount: 150000,
      value: 285.60,
      priceChange: 15.7,
      iconColor: "#712B13",
      iconBg: "#FAECE7",
    },
  ]);

  const totalValue = holdings.reduce((sum, holding) => sum + holding.value, 0);

  return (
    <div className="flex flex-col h-full bg-[#05070B]">
      {/* Top Bar */}
      <div className="shrink-0 border-b border-[#1a1f2e]/80 bg-[#05070B]/80 backdrop-blur-xl z-20">
        <div className="max-w-[1280px] mx-auto flex items-center gap-3 px-4 py-4">
          <button
            onClick={() => navigate("/profile")}
            className="flex items-center justify-center w-10 h-10 rounded-full border border-[#1a1f2e] bg-[#0B0F17] transition-all hover:scale-110 hover:border-[#00FFA3]/50"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          
          {/* App Branding */}
          <div className="flex shrink-0 items-center gap-4 mr-2">
            <div className="flex items-center justify-center h-12 w-12 md:h-[54px] md:w-[54px]">
              <img src="/Delphi.svg" alt="Delphi Logo" className="h-full w-full object-contain" />
            </div>
            <span className="text-xl tracking-widest mt-1" style={{ fontFamily: '"Press Start 2P", system-ui' }}><span className="text-white">DEL</span><span className="text-[#00FFA3]">PHI</span></span>
          </div>

          <div className="ml-auto">
            <h1 className="btn-font text-sm font-bold text-white tracking-widest uppercase">
              Tokens Held
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 md:py-6">
        <div className="max-w-[1280px] mx-auto">
          {/* Summary Card */}
          <div className="bg-[#0B0F17]/80 border border-[#1a1f2e] rounded-2xl p-4 md:p-5 mb-4 md:mb-6 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#00FFA3]/5 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-center justify-between mb-3 relative">
              <div>
                <div className="text-[10px] text-[#5a6078] mb-1 font-bold uppercase tracking-widest">
                  Total Portfolio Value
                </div>
                <div className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: '"Clash Display", sans-serif' }}>
                  ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-[#5a6078] mb-1 font-bold uppercase tracking-widest">
                  Total Tokens
                </div>
                <div className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: '"Clash Display", sans-serif' }}>
                  {holdings.length}
                </div>
              </div>
            </div>
          </div>

        {/* Holdings List */}
        <div className="space-y-3 md:space-y-4">
          {holdings.map((holding) => (
            <div
              key={holding.id}
              className="relative"
            >
              {/* Glow effect */}
              <div className="absolute -inset-0.5 bg-gradient-to-r from-gray-600/20 via-gray-400/20 to-gray-600/20 rounded-2xl blur-sm"></div>
              
              {/* Card */}
              <div className="relative bg-black border border-gray-700 rounded-2xl p-4 md:p-5 hover:border-gray-500 transition-all">
                <div className="flex items-center gap-3 md:gap-4 mb-4">
                  {/* Token Icon */}
                  <div
                    className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-lg md:text-xl font-medium flex-shrink-0"
                    style={{
                      backgroundColor: holding.iconBg,
                      color: holding.iconColor,
                    }}
                  >
                    {holding.icon}
                  </div>

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <button 
                      onClick={() => navigate(`/token/${holding.name.toLowerCase()}`)}
                      className="text-base md:text-lg font-bold text-white mb-0.5 hover:text-blue-400 transition-colors text-left w-full"
                    >
                      {holding.name}
                    </button>
                    <div className="text-xs md:text-sm text-gray-400">
                      {holding.ticker}
                    </div>
                  </div>

                  {/* Price Change */}
                  <div className="text-right">
                    <div className={`flex items-center gap-1 text-sm md:text-base font-bold ${
                      holding.priceChange >= 0 ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {holding.priceChange >= 0 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      {holding.priceChange >= 0 ? '+' : ''}{holding.priceChange}%
                    </div>
                  </div>
                </div>

                {/* Holdings Details */}
                <div className="grid grid-cols-2 gap-3 mb-4 px-2">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Amount</div>
                    <div className="text-sm md:text-base font-medium text-white">
                      {holding.amount.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1">Value</div>
                    <div className="text-sm md:text-base font-bold text-white">
                      ${holding.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 md:gap-3">
                  <button className="flex-1 px-4 py-2.5 md:py-3 text-sm md:text-base font-bold bg-[#4ade80] text-white rounded-xl hover:bg-[#22c55e] transition-all shadow-[0_4px_14px_0_rgba(74,222,128,0.5)] hover:shadow-[0_6px_20px_rgba(74,222,128,0.7)] hover:scale-105 active:scale-95">
                    Buy
                  </button>
                  <button className="flex-1 px-4 py-2.5 md:py-3 text-sm md:text-base font-bold bg-[#ef4444] text-white rounded-xl hover:bg-[#dc2626] transition-all shadow-[0_4px_14px_0_rgba(239,68,68,0.5)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.7)] hover:scale-105 active:scale-95">
                    Sell
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);
}