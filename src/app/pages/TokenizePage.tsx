import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Coins, Upload, Twitter, Globe, Plus, X, User } from "lucide-react";
import { NavButtons } from "../components/NavButtons";
import { getPhantom, hasAnySolanaWallet, shortAddress } from "../../lib/phantom";
import { requestWalletNonce, verifyWalletSignature, logoutWalletSession } from "../../lib/api";
import { runBagsLaunch, stepLabel } from "../../lib/bagsLaunch";

// ── Bags API limits (from bags-api-token-launch-guide.md) ──────
const NAME_MAX = 32;
const SYMBOL_MAX = 10;
const DESCRIPTION_MAX = 1000;
const MIN_LIQUIDITY_SOL = 0.21;
/** Buffer above the initial buy that we recommend the wallet hold to cover tx fees + rent + fee-share txs. */
const SOL_BUFFER = 0.05;
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export function TokenizePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const narrative = location.state?.narrative || "New narrative";
  const suggestedNameFromState: string | undefined = location.state?.suggestedName;
  const tweetIdFromState: string | null = location.state?.tweetId ?? null;

  const [tokenName, setTokenName] = useState(suggestedNameFromState ?? "");
  const [ticker, setTicker] = useState(
    suggestedNameFromState ? suggestedNameFromState.slice(0, SYMBOL_MAX).toUpperCase() : "",
  );
  const [description, setDescription] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [liquidity, setLiquidity] = useState("0.5");
  const [decimals, setDecimals] = useState("9");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [feeSharing, setFeeSharing] = useState(false);
  const [ownership, setOwnership] = useState("0");
  const [feeRecipients, setFeeRecipients] = useState<Array<{ username: string; percentage: string }>>([
    { username: "", percentage: "" }
  ]);

  // Wallet + launch state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [walletBalanceSol, setWalletBalanceSol] = useState<number | null>(null);
  const [balanceCheckedAt, setBalanceCheckedAt] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchStep, setLaunchStep] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("walletAuthToken");
    const address = localStorage.getItem("walletAddress");
    if (token && address) {
      setAuthToken(token);
      setWalletAddress(address);
    }
    const provider = getPhantom();
    if (provider && !address) {
      provider.connect({ onlyIfTrusted: true })
        .then(({ publicKey }) => setWalletAddress(publicKey.toString()))
        .catch(() => {});
    }
  }, []);

  // Refresh SOL balance whenever wallet changes
  useEffect(() => {
    if (!walletAddress) {
      setWalletBalanceSol(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(SOLANA_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [walletAddress],
          }),
        });
        const j = (await r.json()) as { result?: { value?: number } };
        if (cancelled) return;
        const lamports = j.result?.value ?? 0;
        setWalletBalanceSol(lamports / 1e9);
        setBalanceCheckedAt(Date.now());
      } catch {
        if (!cancelled) setWalletBalanceSol(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const handleConnectWallet = async () => {
    const provider = getPhantom();
    if (!provider) {
      alert(hasAnySolanaWallet() ? "Use Phantom wallet" : "Install Phantom wallet");
      return;
    }
    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toString();
      if (!provider.signMessage) {
        alert("This wallet does not support signMessage.");
        return;
      }
      const { nonce, message } = await requestWalletNonce(address);
      const encodedMessage = new TextEncoder().encode(message);
      const signed = await provider.signMessage(encodedMessage, "utf8");
      const signatureB64 = btoa(String.fromCharCode(...signed.signature));
      const verified = await verifyWalletSignature({ address, nonce, signature: signatureB64 });
      setAuthToken(verified.token);
      localStorage.setItem("walletAuthToken", verified.token);
      localStorage.setItem("walletAddress", verified.address);
      setWalletAddress(verified.address);
    } catch (e) {
      console.error("[wallet] connect failed", e);
    }
  };

  const handleDisconnectWallet = async () => {
    const provider = getPhantom();
    try {
      if (authToken) await logoutWalletSession(authToken);
      await provider?.disconnect();
    } finally {
      setAuthToken(null);
      setWalletAddress(null);
      setWalletBalanceSol(null);
      localStorage.removeItem("walletAddress");
      localStorage.removeItem("walletAuthToken");
    }
  };

  // ── Validation derived from current form state ─────────────────
  const liquidityNum = Number(liquidity);
  const requiredSol = Number.isFinite(liquidityNum) ? liquidityNum + SOL_BUFFER : MIN_LIQUIDITY_SOL + SOL_BUFFER;
  const balanceWarning =
    walletBalanceSol !== null && walletBalanceSol < requiredSol
      ? `Wallet balance ${walletBalanceSol.toFixed(4)} SOL is below the recommended ${requiredSol.toFixed(2)} SOL (initial buy + ~${SOL_BUFFER} fees/rent). Launch will likely fail at create-launch-transaction.`
      : null;

  const feeBpsTotal = feeSharing
    ? feeRecipients.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) * 100
    : 10000;
  const feeBpsValid = feeBpsTotal === 10000;

  const validationIssues: string[] = [];
  if (!tokenName.trim()) validationIssues.push("Token name is required.");
  else if (tokenName.length > NAME_MAX) validationIssues.push(`Token name max ${NAME_MAX} chars (Bags rule).`);
  if (!ticker.trim()) validationIssues.push("Ticker is required.");
  else if (ticker.length > SYMBOL_MAX) validationIssues.push(`Ticker max ${SYMBOL_MAX} chars (Bags rule).`);
  else if (ticker.includes("$")) validationIssues.push("Ticker must not include the $ symbol.");
  if (description.length > DESCRIPTION_MAX)
    validationIssues.push(`Description max ${DESCRIPTION_MAX} chars (Bags rule).`);
  if (!Number.isFinite(liquidityNum) || liquidityNum < MIN_LIQUIDITY_SOL)
    validationIssues.push(`Initial liquidity must be at least ${MIN_LIQUIDITY_SOL} SOL (Bags minimum).`);
  if (feeSharing && !feeBpsValid)
    validationIssues.push(`Fee-share percentages must sum to exactly 100% (currently ${(feeBpsTotal / 100).toFixed(2)}%).`);
  if (feeSharing && feeRecipients.some((r) => !r.username.trim()))
    validationIssues.push("Fee sharing: every recipient needs a username (or wallet) before launch.");
  if (imageUrl && !/^https?:\/\//i.test(imageUrl))
    validationIssues.push("Image URL must start with https:// or http://.");

  const canLaunch = validationIssues.length === 0 && !launching;

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

  const handleLaunch = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setLaunching(true);
    try {
      const result = await runBagsLaunch(
        {
          narrative,
          name: tokenName.trim(),
          ticker: ticker.trim(),
          liquiditySol: liquidity,
          imageUrl: imageUrl.trim() || undefined,
          tweetId: tweetIdFromState,
        },
        { walletAddress, authToken, setWalletAddress, setAuthToken },
        (s) => setLaunchStep(stepLabel[s]),
      );
      setLaunchStep("");
      setSuccessMsg(
        result.mintUrl
          ? `Launched! View on Bags: ${result.mintUrl}`
          : "Launch saved.",
      );
      // Prefer redirecting to the new token's detail page; fall back to feed.
      const redirectTo = result.tokenMint ? `/token/${result.tokenMint}` : "/";
      setTimeout(() => navigate(redirectTo), 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Launch failed");
      setLaunchStep("");
    } finally {
      setLaunching(false);
    }
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
    <div className="flex flex-col h-full bg-[#05070B]">
      {/* Top Bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#1a1f2e]/80 bg-[#05070B]/80 backdrop-blur-xl px-4 py-4 z-20">
        <NavButtons />
        <div className="flex-1" />
        <div className="flex items-center gap-2">
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto">
          {/* Info Card */}
          <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4 md:p-5 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-[#00FFA3]/10 border border-[#00FFA3]/20 flex items-center justify-center">
                <Coins className="w-5 h-5 md:w-6 md:h-6 text-[#00FFA3]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm md:text-base font-bold text-white">
                  Tokenizing narrative
                </div>
                <div className="text-xs md:text-sm text-[#5a6078] truncate">
                  Create a new token for this trending topic
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1">
                Narrative
              </div>
              <div className="text-sm text-[#8b92a8] font-medium break-words">
                {narrative}
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="rounded-xl border border-[#1a1f2e] bg-[#0B0F17]/80 backdrop-blur-sm p-4 md:p-5 space-y-4">
            {/* Token Image */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-2">
                Token Image
              </label>
              <div className="flex items-center gap-4">
                {imagePreview ? (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden border border-[#1a1f2e]">
                    <img src={imagePreview} alt="Token" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl border border-dashed border-[#1a1f2e] flex items-center justify-center bg-[#05070B]/40">
                    <Upload className="w-6 h-6 md:w-8 md:h-8 text-[#5a6078]" />
                  </div>
                )}
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <div className="px-4 py-2 text-xs font-bold border border-[#1a1f2e] rounded-lg text-[#8b92a8] hover:bg-[#151a26] transition-all cursor-pointer text-center uppercase tracking-wider">
                    Upload Image
                  </div>
                  <p className="text-[11px] text-[#5a6078] mt-1">Paste a public image URL below for Bags launch.</p>
                </label>
              </div>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/token-image.png (optional)"
                className="mt-3 w-full px-3 py-2 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
              />
            </div>

            {/* Token Name */}
            <div>
              <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                <span>Token Name *</span>
                <span className={tokenName.length > NAME_MAX ? "text-red-400 font-bold" : "text-[#3a4058]"}>
                  {tokenName.length}/{NAME_MAX}
                </span>
              </label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                maxLength={NAME_MAX}
                placeholder="e.g. RWASOLANA"
                className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
              />
            </div>

            {/* Ticker */}
            <div>
              <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                <span>Ticker Symbol *</span>
                <span className={ticker.length > SYMBOL_MAX ? "text-red-400 font-bold" : "text-[#3a4058]"}>
                  {ticker.length}/{SYMBOL_MAX}
                </span>
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/\$/g, ""))}
                placeholder="e.g. RWAS"
                maxLength={SYMBOL_MAX}
                className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
              />
              <p className="text-[11px] text-[#5a6078] mt-1">No $ prefix. Auto-uppercased.</p>
            </div>

            {/* Description */}
            <div>
              <label className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                <span>Description</span>
                <span className={description.length > DESCRIPTION_MAX ? "text-red-400 font-bold" : "text-[#3a4058]"}>
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={DESCRIPTION_MAX}
                placeholder="Describe your token and its purpose..."
                rows={4}
                className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors resize-none"
              />
            </div>

            {/* Supply and Decimals Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                  Total Supply *
                </label>
                <input
                  type="number"
                  value={supply}
                  onChange={(e) => setSupply(e.target.value)}
                  placeholder="1000000000"
                  min="1"
                  className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                  Decimals *
                </label>
                <input
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                  placeholder="9"
                  min="0"
                  max="18"
                  className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                />
              </div>
            </div>

            {/* Initial Liquidity */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                Initial Liquidity (SOL) *
              </label>
              <input
                type="number"
                value={liquidity}
                onChange={(e) => setLiquidity(e.target.value)}
                placeholder="0.5"
                min="0.1"
                step="0.1"
                className="w-full px-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
              />
              <p className="text-[11px] text-[#5a6078] mt-1">Bags minimum: {MIN_LIQUIDITY_SOL} SOL. Wallet should hold initial buy + ~{SOL_BUFFER} SOL for fees.</p>
            </div>

            {/* Social Links Section */}
            <div className="pt-2 border-t border-[#1a1f2e]/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6078] mb-3">Social Links (Optional)</h3>
              
              {/* Website */}
              <div className="mb-4">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                  Website
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a6078]" />
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourwebsite.com"
                    className="w-full pl-10 pr-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                  />
                </div>
              </div>

              {/* X (Twitter) */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5a6078] mb-1.5">
                  X (Twitter)
                </label>
                <div className="relative">
                  <Twitter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a6078]" />
                  <input
                    type="text"
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="@yourhandle"
                    className="w-full pl-10 pr-3 py-2 md:py-2.5 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Fee Sharing Option */}
            <div className="pt-2 border-t border-[#1a1f2e]/60">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setFeeSharing(!feeSharing)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    feeSharing ? 'bg-[#00FFA3]' : 'bg-[#1a1f2e]'
                  }`}
                  role="switch"
                  aria-checked={feeSharing}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#05070B] shadow ring-0 transition duration-200 ease-in-out ${
                      feeSharing ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <label className="text-sm font-bold text-white cursor-pointer" onClick={() => setFeeSharing(!feeSharing)}>
                    Fee Sharing
                  </label>
                  <p className="text-[11px] text-[#5a6078] mt-0.5">
                    Share fees with up to 100 apps or wallets
                  </p>
                </div>
              </div>
            </div>

            {/* Fee Recipients */}
            {feeSharing && (
              <div className="pt-2 border-t border-[#1a1f2e]/60">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6078]">Fee Recipients</h3>
                  <span className={feeBpsValid ? "text-[10px] font-bold text-[#00FFA3] bg-[#00FFA3]/10 border border-[#00FFA3]/20 px-2 py-0.5 rounded" : "text-[10px] font-bold text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded"}>
                    Total: {(feeBpsTotal / 100).toFixed(2)}% / 100%
                  </span>
                </div>
                <p className="text-[11px] text-[#5a6078] mb-3">Percentages must sum to exactly 100%. Max 100 recipients.</p>
                
                <div className="space-y-2">
                  {feeRecipients.map((recipient, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={recipient.username}
                        onChange={(e) => updateFeeRecipient(index, 'username', e.target.value)}
                        placeholder="Username"
                        className="w-full px-3 py-2 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                      />
                      <input
                        type="number"
                        value={recipient.percentage}
                        onChange={(e) => updateFeeRecipient(index, 'percentage', e.target.value)}
                        placeholder="Percentage"
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 text-sm border border-[#1a1f2e] rounded-lg bg-[#05070B] text-white placeholder:text-[#5a6078] focus:border-[#00FFA3] outline-none transition-colors"
                      />
                      <button
                        onClick={() => removeFeeRecipient(index)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a1f2e] bg-[#0B0F17] transition-all hover:border-[#242b3d] text-[#8b92a8]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addFeeRecipient}
                  className="mt-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-[#1a1f2e] rounded-lg text-[#8b92a8] hover:bg-[#151a26] transition-all"
                >
                  <Plus className="w-3 h-3 inline mr-1" />
                  Add Recipient
                </button>
              </div>
            )}

            {/* Ownership Option */}
            <div className="pt-2 border-t border-[#1a1f2e]/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6078] mb-3">Ownership</h3>
              <p className="text-[11px] text-[#5a6078] mb-3">Buy the token before anyone else</p>
              
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {ownershipOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setOwnership(option.value)}
                    className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all uppercase tracking-wider ${
                      ownership === option.value
                        ? 'bg-[#00FFA3] text-black border-[#00FFA3]'
                        : 'bg-[#05070B] text-[#8b92a8] border-[#1a1f2e] hover:border-[#242b3d]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bags requirements panel */}
            <div className="rounded-xl border border-[#1a1f2e] bg-[#05070B]/60 p-3 md:p-4 text-[11px] text-[#8b92a8] space-y-1.5">
              <p className="font-bold text-white text-xs uppercase tracking-wider">Bags Launch Requirements</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>Name ≤ {NAME_MAX} chars; ticker ≤ {SYMBOL_MAX} chars (no $); description ≤ {DESCRIPTION_MAX} chars.</li>
                <li>Initial liquidity ≥ {MIN_LIQUIDITY_SOL} SOL.</li>
                <li>Wallet must hold roughly <span className="font-bold text-white">{requiredSol.toFixed(2)} SOL</span> (initial buy + tx fees + rent).</li>
                <li>If fee sharing is on, recipient percentages must sum to exactly 100%.</li>
                <li>Image URL must be publicly reachable, &lt; 15 MB.</li>
              </ul>
            </div>

            {balanceWarning ? (
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-400 font-medium">
                {balanceWarning}
              </div>
            ) : null}

            {validationIssues.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
                <p className="font-bold mb-1 text-white">Fix before launching:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {validationIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {errorMsg ? (
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-400">
                {errorMsg}
              </div>
            ) : null}
            {successMsg ? (
              <div className="rounded-xl border border-[#00FFA3]/30 bg-[#00FFA3]/10 p-3 text-sm text-[#00FFA3]">
                {successMsg}
              </div>
            ) : null}
            {launching && launchStep ? (
              <div className="rounded-xl border border-[#00FFA3]/30 bg-[#00FFA3]/10 p-3 text-sm text-[#00FFA3]">
                {launchStep}
              </div>
            ) : null}

            {/* Action Buttons */}
            <div className="flex flex-col md:flex-row gap-2 md:gap-3 pt-2">
              <button
                onClick={() => navigate("/")}
                className="w-full md:flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-[#1a1f2e] rounded-lg text-[#8b92a8] hover:bg-[#151a26] transition-all active:translate-y-[1px]"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleLaunch()}
                disabled={!canLaunch}
                className="w-full md:flex-1 px-6 py-2 text-xs font-bold uppercase tracking-wider rounded-lg bg-[#00FFA3] text-black hover:bg-[#33ffb5] transition-all active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {launching ? "Launching…" : "Launch Token"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}