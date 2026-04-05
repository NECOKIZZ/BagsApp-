import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowLeft, Coins, Upload, Twitter, Globe, ChevronDown, Plus, X } from "lucide-react";

export function TokenizePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const narrative = location.state?.narrative || "New narrative";

  const [tokenName, setTokenName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [liquidity, setLiquidity] = useState("0.5");
  const [decimals, setDecimals] = useState("9");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [feeSharing, setFeeSharing] = useState(false);
  const [ownership, setOwnership] = useState("0");
  const [feeRecipients, setFeeRecipients] = useState<Array<{ username: string; percentage: string }>>([
    { username: "", percentage: "" }
  ]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLaunch = () => {
    // Mock token launch
    alert(`Launching ${tokenName} (${ticker}) with ${liquidity} SOL liquidity and ${ownership}% ownership`);
    navigate("/");
  };

  const addFeeRecipient = () => {
    if (feeRecipients.length < 100) {
      setFeeRecipients([...feeRecipients, { username: "", percentage: "" }]);
    }
  };

  const removeFeeRecipient = (index: number) => {
    if (feeRecipients.length > 1) {
      setFeeRecipients(feeRecipients.filter((_, i) => i !== index));
    }
  };

  const updateFeeRecipient = (index: number, field: 'username' | 'percentage', value: string) => {
    const updated = [...feeRecipients];
    updated[index][field] = value;
    setFeeRecipients(updated);
  };

  const ownershipOptions = [
    { value: "0", label: "0%" },
    { value: "1", label: "1%" },
    { value: "10", label: "10%" },
    { value: "30", label: "30%" },
    { value: "50", label: "50%" },
    { value: "80", label: "80%" },
  ];

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 md:px-5 py-3 bg-white border-b border-gray-200 shadow-sm">
        <button
          onClick={() => navigate("/")}
          className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <h1 className="text-sm font-bold text-gray-900">
          Launch Token
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 md:py-6">
        <div className="max-w-2xl mx-auto">
          {/* Info Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 mb-4 md:mb-6 shadow-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-black flex items-center justify-center shadow-lg">
                <Coins className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm md:text-base font-bold text-gray-800">
                  Tokenizing narrative
                </div>
                <div className="text-xs md:text-sm text-gray-500 truncate">
                  Create a new token for this trending topic
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <div className="text-xs text-gray-600 mb-1 font-medium">
                Narrative
              </div>
              <div className="text-sm text-gray-800 font-medium break-words">
                {narrative}
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 space-y-4 shadow-lg">
            {/* Token Image */}
            <div>
              <label className="block text-xs text-gray-700 mb-2 font-medium">
                Token Image
              </label>
              <div className="flex items-center gap-4">
                {imagePreview ? (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden border-2 border-gray-300">
                    <img src={imagePreview} alt="Token" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50">
                    <Upload className="w-6 h-6 md:w-8 md:h-8 text-gray-400" />
                  </div>
                )}
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <div className="px-4 py-2 text-sm font-medium border-2 border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all cursor-pointer text-center">
                    Upload Image
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Recommended: 512x512px PNG or JPG</p>
                </label>
              </div>
            </div>

            {/* Token Name */}
            <div>
              <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                Token Name *
              </label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. RWASOLANA"
                className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
              />
            </div>

            {/* Ticker */}
            <div>
              <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                Ticker Symbol *
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g. RWAS"
                maxLength={10}
                className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your token and its purpose..."
                rows={4}
                className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium resize-none"
              />
            </div>

            {/* Supply and Decimals Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                  Total Supply *
                </label>
                <input
                  type="number"
                  value={supply}
                  onChange={(e) => setSupply(e.target.value)}
                  placeholder="1000000000"
                  min="1"
                  className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                  Decimals *
                </label>
                <input
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                  placeholder="9"
                  min="0"
                  max="18"
                  className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                />
              </div>
            </div>

            {/* Initial Liquidity */}
            <div>
              <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                Initial Liquidity (SOL) *
              </label>
              <input
                type="number"
                value={liquidity}
                onChange={(e) => setLiquidity(e.target.value)}
                placeholder="0.5"
                min="0.1"
                step="0.1"
                className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 0.1 SOL required</p>
            </div>

            {/* Social Links Section */}
            <div className="pt-2 border-t border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Social Links (Optional)</h3>
              
              {/* Website */}
              <div className="mb-4">
                <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                  Website
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    className="w-full pl-10 pr-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                  />
                </div>
              </div>

              {/* X (Twitter) */}
              <div>
                <label className="block text-xs text-gray-700 mb-1.5 font-medium">
                  X (Twitter)
                </label>
                <div className="relative">
                  <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="@yourhandle"
                    className="w-full pl-10 pr-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Fee Sharing Option */}
            <div className="pt-2 border-t border-gray-200">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setFeeSharing(!feeSharing)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 ${
                    feeSharing ? 'bg-black' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={feeSharing}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      feeSharing ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-800 cursor-pointer" onClick={() => setFeeSharing(!feeSharing)}>
                    Fee Sharing
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Share fees with up to 100 creators, apps or wallets
                  </p>
                </div>
              </div>
            </div>

            {/* Fee Recipients */}
            {feeSharing && (
              <div className="pt-2 border-t border-gray-200">
                <h3 className="text-sm font-bold text-gray-800 mb-3">Fee Recipients</h3>
                <p className="text-xs text-gray-500 mb-3">Add up to 100 recipients to share fees with</p>
                
                <div className="space-y-2">
                  {feeRecipients.map((recipient, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={recipient.username}
                        onChange={(e) => updateFeeRecipient(index, 'username', e.target.value)}
                        placeholder="Username"
                        className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                      />
                      <input
                        type="number"
                        value={recipient.percentage}
                        onChange={(e) => updateFeeRecipient(index, 'percentage', e.target.value)}
                        placeholder="Percentage"
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 md:py-2.5 text-sm border-2 border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:border-black outline-none transition-colors font-medium"
                      />
                      <button
                        onClick={() => removeFeeRecipient(index)}
                        className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5 text-gray-900" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addFeeRecipient}
                  className="mt-2 px-4 py-2.5 text-sm font-medium border-2 border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Recipient
                </button>
              </div>
            )}

            {/* Ownership Option */}
            <div className="pt-2 border-t border-gray-200">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Ownership</h3>
              <p className="text-xs text-gray-500 mb-3">Buy the token before anyone else</p>
              
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {ownershipOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setOwnership(option.value)}
                    className={`px-4 py-2.5 text-sm font-medium rounded-lg border-2 transition-all ${
                      ownership === option.value
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Minimum Amount Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4">
              <p className="text-xs md:text-sm text-amber-800 font-medium">
                ⚠️ Minimum amount to tokenize: <span className="font-bold">0.21 SOL</span>
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col md:flex-row gap-2 md:gap-3 pt-2">
              <button
                onClick={() => navigate("/")}
                className="w-full md:flex-1 px-4 py-2.5 md:py-3 text-sm font-medium border-2 border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleLaunch}
                disabled={!tokenName || !ticker || !supply || !decimals || parseFloat(liquidity) < 0.21}
                className="w-full md:flex-1 px-6 py-2.5 md:py-3 text-sm md:text-base font-bold rounded-lg bg-[#4ade80] text-white hover:bg-[#22c55e] transition-all shadow-[0_4px_14px_0_rgba(74,222,128,0.5)] hover:shadow-[0_6px_20px_rgba(74,222,128,0.7)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#4ade80] disabled:shadow-[0_4px_14px_0_rgba(74,222,128,0.5)]"
              >
                Launch Token
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}