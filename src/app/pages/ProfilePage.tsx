import { Wallet, TrendingUp, TrendingDown, DollarSign, Activity, Star, Send, Copy, Settings } from "lucide-react";
import { useNavigate } from "react-router";
import { useState } from "react";

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

export function ProfilePage() {
  const navigate = useNavigate();
  const [isCopied, setIsCopied] = useState(false);

  // Mock token holdings data - sorted by value from highest to lowest
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

  const handleCopyAddress = () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    
    // Fallback method for copying text
    const textArea = document.createElement('textarea');
    textArea.value = address;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      textArea.remove();
      setIsCopied(true);
      // Hide message after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
      console.log('Address copied to clipboard');
    } catch (err) {
      console.error('Failed to copy address:', err);
      textArea.remove();
    }
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 md:py-6 relative">
        {/* Copied Message */}
        {isCopied && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
            <div className="bg-black text-white px-4 py-2 rounded-xl shadow-lg border border-gray-700 flex items-center gap-2">
              <Copy className="w-4 h-4" />
              <span className="text-sm font-bold">Wallet address copied!</span>
            </div>
          </div>
        )}
        
        {/* Profile Card */}
        <div className="border border-gray-200 rounded-2xl p-4 md:p-5 mb-4 shadow-lg bg-[#ebebeb]">
          <div className="flex items-center gap-3 mb-4">
            <img 
              src="https://images.unsplash.com/photo-1672685667592-0392f458f46f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBtYW4lMjBwb3J0cmFpdCUyMGhlYWRzaG90fGVufDF8fHx8MTc3NTA3ODA2Nnww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
              alt="Profile avatar"
              className="w-12 h-12 md:w-14 md:h-14 rounded-full object-cover border-2 border-gray-300 shadow-lg"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm md:text-base font-bold text-gray-900">
                Alex Morgan
              </div>
              <div className="text-xs text-gray-500">
                @alexmorgan
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Settings Button */}
              <button
                onClick={() => {/* Add settings functionality */}}
                className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center hover:bg-gray-50 hover:border-gray-400 hover:scale-110 transition-all shadow-md"
                title="Settings"
              >
                <Settings className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-700" />
              </button>
              
              {/* Copy Wallet Address Button */}
              <button
                onClick={handleCopyAddress}
                className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center hover:bg-gray-50 hover:border-gray-400 hover:scale-110 transition-all shadow-md"
                title="Copy wallet address"
              >
                <Copy className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-700" />
              </button>
              
              {/* Send Button */}
              <button
                onClick={() => {/* Add send functionality */}}
                className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-black border-2 border-gray-200 flex items-center justify-center hover:bg-gray-800 hover:scale-110 transition-all shadow-lg"
                title="Send"
              >
                <Send className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <div className="text-xs text-gray-600 mb-1 font-medium">
                Total Value
              </div>
              <div className="font-bold text-gray-900 text-[24px] md:text-[32px]">
                ${totalValue.toFixed(2)}
              </div>
              <div className="text-xs font-bold text-green-600 mt-1">+12.5%</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <div className="text-xs text-gray-600 mb-1 font-medium">
                Tokens Held
              </div>
              <div className="font-bold text-gray-900 text-[24px] md:text-[32px]">
                {holdings.length}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border border-gray-200 rounded-2xl p-3 md:p-4 shadow-lg bg-[#ffffff]">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <Star className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-600" />
              <span className="text-xs font-bold text-gray-800">
                User Score
              </span>
            </div>
            <div className="font-bold text-gray-900 text-[32px]">
              87.5
            </div>
            <div className="text-xs text-green-600 font-medium">
              Top 10%
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-3 md:p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4 text-green-600" />
              <span className="text-xs font-bold text-gray-800">
                Best Performer
              </span>
            </div>
            <div className="font-bold text-gray-900 mb-1 md:mb-2 truncate text-xl md:text-[32px]">
              RWASOLANA
            </div>
            <div className="font-bold text-green-600 text-[14px] md:text-[16px]">
              +840%
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-3 md:p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <DollarSign className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-600" />
              <span className="text-xs font-bold text-gray-800">
                Tokens Launched
              </span>
            </div>
            <div className="font-bold text-gray-900 text-[32px]">
              3
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-3 md:p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <Activity className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-600" />
              <span className="text-xs font-bold text-gray-800">
                Total Trades
              </span>
            </div>
            <div className="font-bold text-gray-900 text-[32px]">
              47
            </div>
          </div>
        </div>

        {/* Tokens Held Section */}
        <div className="mb-4">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-4 px-1">
            Your Tokens
          </h2>
          
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