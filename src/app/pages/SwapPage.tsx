import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowDownUp,
  Loader2,
  AlertCircle,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import { fetchJupiterTokenMap, type TokenMeta, SOL_MINT } from "../../lib/jupiter";
import { getPhantom } from "../../lib/phantom";
import { Connection, VersionedTransaction } from "@solana/web3.js";

const RPC_URL =
  ((import.meta as any).env?.VITE_SOLANA_RPC as string | undefined)?.trim() ||
  "https://mainnet.helius-rpc.com/?api-key=50a515f8-c104-446d-8a38-d2f9066ed07e";
const JUPITER_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap/v1/swap";

type QuoteResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
};

/* ── Token picker modal ─────────────────────────────────────────── */
function TokenPicker({
  tokens,
  onSelect,
  onClose,
}: {
  tokens: TokenMeta[];
  onSelect: (t: TokenMeta) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return tokens.slice(0, 50);
    const q = query.toLowerCase();
    return tokens
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [tokens, query]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#1a1f2e] bg-[#0B0F17] shadow-xl flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1f2e]">
          <Search className="w-4 h-4 text-[#5a6078] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, symbol, or address…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#5a6078] outline-none"
          />
          <button onClick={onClose} className="text-[#5a6078] hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-[#5a6078] py-6">No tokens found</div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.address}
                onClick={() => onSelect(t)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#151a26] transition-colors text-left"
              >
                {t.logoURI ? (
                  <img src={t.logoURI} alt="" className="w-8 h-8 rounded-full bg-[#151a26]" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#151a26] flex items-center justify-center text-[10px] font-bold text-[#5a6078]">
                    {t.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{t.symbol}</div>
                  <div className="text-[11px] text-[#5a6078] truncate">{t.name}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main SwapPage ──────────────────────────────────────────────── */
export function SwapPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const paramInput = searchParams.get("inputMint") || SOL_MINT;
  const paramOutput = searchParams.get("outputMint") || "";

  const [tokenMap, setTokenMap] = useState<Map<string, TokenMeta>>(new Map());
  const [tokenList, setTokenList] = useState<TokenMeta[]>([]);
  const [inputMint, setInputMint] = useState(paramInput);
  const [outputMint, setOutputMint] = useState(paramOutput);

  // Keep state in sync when URL params change (e.g. clicking another BUY link)
  useEffect(() => {
    setInputMint(paramInput);
    setOutputMint(paramOutput);
    setQuote(null);
    setSwapSuccess(null);
    setSwapError(null);
    setInputAmount("");
  }, [paramInput, paramOutput]);
  const [inputAmount, setInputAmount] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapSuccess, setSwapSuccess] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<"input" | "output" | null>(null);
  const [unknownTokens, setUnknownTokens] = useState<Map<string, TokenMeta>>(new Map());

  // Load token map
  useEffect(() => {
    void fetchJupiterTokenMap().then((map) => {
      setTokenMap(map);
      setTokenList(Array.from(map.values()));
    });
  }, []);

  // Resolve tokens not in the Jupiter verified list (e.g. newly launched tokens)
  useEffect(() => {
    if (tokenMap.size === 0) return;
    const mintsToResolve = [inputMint, outputMint].filter(
      (m) => m && m.length > 20 && !tokenMap.has(m) && !unknownTokens.has(m),
    );
    if (mintsToResolve.length === 0) return;

    for (const mint of mintsToResolve) {
      void (async () => {
        try {
          // Try Jupiter all-tokens endpoint for metadata
          const res = await fetch(`https://tokens.jup.ag/token/${mint}`);
          if (res.ok) {
            const data = (await res.json()) as { address: string; symbol?: string; name?: string; logoURI?: string; decimals?: number };
            if (data.address) {
              setUnknownTokens((prev) => {
                const next = new Map(prev);
                next.set(mint, {
                  address: data.address,
                  symbol: data.symbol ?? mint.slice(0, 6),
                  name: data.name ?? "Unknown Token",
                  logoURI: data.logoURI,
                  decimals: data.decimals ?? 9,
                });
                return next;
              });
              return;
            }
          }
        } catch { /* ignore */ }
        // Fallback: show abbreviated address
        setUnknownTokens((prev) => {
          const next = new Map(prev);
          next.set(mint, {
            address: mint,
            symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
            name: "Unknown Token",
            decimals: 9,
          });
          return next;
        });
      })();
    }
  }, [tokenMap, inputMint, outputMint, unknownTokens]);

  const inputToken = tokenMap.get(inputMint) ?? unknownTokens.get(inputMint) ?? null;
  const outputToken = tokenMap.get(outputMint) ?? unknownTokens.get(outputMint) ?? null;

  // Fetch quote when input changes
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchQuote = useCallback(async () => {
    if (!inputMint || !outputMint || !inputAmount || Number(inputAmount) <= 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const decimals = inputToken?.decimals ?? 9;
    const amountLamports = Math.round(Number(inputAmount) * 10 ** decimals);
    if (amountLamports <= 0) return;

    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: String(amountLamports),
        slippageBps: "50",
        restrictIntermediateTokens: "true",
      });
      const res = await fetch(`${JUPITER_QUOTE}?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Quote failed: ${res.status}`);
      }
      const data = (await res.json()) as QuoteResponse;
      setQuote(data);
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "Failed to fetch quote");
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [inputMint, outputMint, inputAmount, inputToken]);

  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => void fetchQuote(), 500);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [fetchQuote]);

  // Format output amount
  const outputAmount = useMemo(() => {
    if (!quote) return "";
    const decimals = outputToken?.decimals ?? 9;
    const raw = Number(quote.outAmount) / 10 ** decimals;
    if (raw >= 1) return raw.toFixed(4);
    if (raw >= 0.0001) return raw.toFixed(6);
    return raw.toFixed(9);
  }, [quote, outputToken]);

  const priceImpact = quote ? parseFloat(quote.priceImpactPct) : null;

  // Swap tokens (flip)
  const handleFlip = () => {
    setInputMint(outputMint);
    setOutputMint(inputMint);
    setInputAmount(outputAmount || "");
    setQuote(null);
  };

  // Execute swap
  const handleSwap = async () => {
    if (!quote) return;
    const provider = getPhantom();
    if (!provider) {
      setSwapError("No wallet found. Install Phantom and connect.");
      return;
    }

    setSwapping(true);
    setSwapError(null);
    setSwapSuccess(null);

    try {
      // Connect if needed
      if (!provider.publicKey) {
        await provider.connect();
      }
      const userPublicKey = provider.publicKey?.toString();
      if (!userPublicKey) throw new Error("Could not get wallet address");

      // Get swap transaction from Jupiter
      const swapRes = await fetch(JUPITER_SWAP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 1000000,
              priorityLevel: "veryHigh",
            },
          },
        }),
      });

      if (!swapRes.ok) {
        const body = await swapRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Swap request failed: ${swapRes.status}`);
      }

      const swapData = (await swapRes.json()) as {
        swapTransaction: string;
        lastValidBlockHeight?: number;
      };
      const { swapTransaction, lastValidBlockHeight } = swapData;

      // Deserialize and sign
      const txBuf = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBuf);

      if (!provider.signTransaction) throw new Error("Wallet does not support signTransaction");
      const signed = await provider.signTransaction(tx);

      // Send and confirm
      const connection = new Connection(RPC_URL, "confirmed");
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        maxRetries: 2,
      });

      // Wait for confirmation with timeout
      const latestBlockHash = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: lastValidBlockHeight ?? latestBlockHash.lastValidBlockHeight,
        },
        "confirmed",
      );

      setSwapSuccess(sig);
      setInputAmount("");
      setQuote(null);
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code === 4001) {
        setSwapError("Transaction rejected in wallet.");
      } else {
        setSwapError(e instanceof Error ? e.message : "Swap failed");
      }
    } finally {
      setSwapping(false);
    }
  };

  const handlePickerSelect = (t: TokenMeta) => {
    if (pickerFor === "input") setInputMint(t.address);
    else setOutputMint(t.address);
    setPickerFor(null);
    setQuote(null);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Top Bar */}
      <div className="shrink-0 border-b border-[#1a1f2e]/80 bg-[#05070B]/80 backdrop-blur-xl z-20">
        <div className="max-w-[1280px] mx-auto flex items-center gap-3 px-4 py-4">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1a1f2e] bg-[#0B0F17] text-[#8b92a8] hover:text-white hover:border-[#242b3d] transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 flex items-center justify-center">
              <img src="/Delphi.svg" alt="Delphi Logo" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-bold tracking-widest" style={{ fontFamily: '"Press Start 2P", system-ui' }}>
              <span className="text-white">SW</span><span className="text-[#00FFA3]">AP</span>
            </span>
          </div>
        </div>
      </div>

      {/* Swap Card */}
      <div className="flex-1 overflow-y-auto flex justify-center items-start p-4 pt-6 md:p-8 md:pt-12">
        <div className="w-full max-w-[520px]">
          <div className="rounded-2xl border border-[#1a1f2e] bg-[#0B0F17]/90 backdrop-blur-sm shadow-[0_0_60px_rgba(0,255,163,0.04)]">
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-xl font-bold text-white">Swap</h2>
              <p className="text-sm text-[#5a6078] mt-1">Trade tokens via Jupiter aggregator</p>
            </div>

            <div className="px-6 pb-6 flex flex-col gap-2">
              {/* Input token */}
              <div className="rounded-xl border border-[#1a1f2e] bg-[#05070B]/60 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#5a6078]">You pay</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-transparent text-3xl font-bold text-white placeholder:text-[#3a4058] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    min="0"
                    step="any"
                  />
                  <button
                    onClick={() => setPickerFor("input")}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#1a1f2e] bg-[#0B0F17] hover:border-[#242b3d] transition-all shrink-0"
                  >
                    {inputToken?.logoURI ? (
                      <img src={inputToken.logoURI} alt="" className="w-6 h-6 rounded-full" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#151a26]" />
                    )}
                    <span className="text-sm font-bold text-white max-w-[100px] truncate">
                      {inputToken?.symbol ?? "Select"}
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#5a6078]" />
                  </button>
                </div>
              </div>

              {/* Flip button */}
              <div className="flex justify-center -my-4 z-10 relative">
                <button
                  onClick={handleFlip}
                  disabled={!outputMint}
                  className="flex items-center justify-center w-11 h-11 rounded-xl border-2 border-[#1a1f2e] bg-[#0B0F17] text-[#5a6078] hover:text-[#00FFA3] hover:border-[#00FFA3]/40 hover:shadow-[0_0_15px_rgba(0,255,163,0.1)] transition-all disabled:opacity-40 shadow-md"
                >
                  <ArrowDownUp className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* Output token */}
              <div className="rounded-xl border border-[#1a1f2e] bg-[#05070B]/60 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#5a6078]">You receive</span>
                  {quoteLoading && <Loader2 className="w-4 h-4 text-[#5a6078] animate-spin" />}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-3xl font-bold text-white min-h-[40px] flex items-center">
                    {quoteLoading ? (
                      <span className="text-[#3a4058]">…</span>
                    ) : outputAmount ? (
                      outputAmount
                    ) : (
                      <span className="text-[#3a4058]">0.00</span>
                    )}
                  </div>
                  <button
                    onClick={() => setPickerFor("output")}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#1a1f2e] bg-[#0B0F17] hover:border-[#242b3d] transition-all shrink-0"
                  >
                    {outputToken?.logoURI ? (
                      <img src={outputToken.logoURI} alt="" className="w-6 h-6 rounded-full" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#151a26]" />
                    )}
                    <span className="text-sm font-bold text-white max-w-[100px] truncate">
                      {outputToken?.symbol ?? "Select"}
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#5a6078]" />
                  </button>
                </div>
              </div>

              {/* Quote info */}
              {quote && (
                <div className="mt-2 rounded-lg border border-[#1a1f2e] bg-[#05070B]/40 px-4 py-3 space-y-1.5">
                  {priceImpact != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#5a6078]">Price Impact</span>
                      <span
                        className={`font-bold ${
                          priceImpact > 3 ? "text-red-400" : priceImpact > 1 ? "text-yellow-400" : "text-[#00FFA3]"
                        }`}
                      >
                        {priceImpact.toFixed(2)}%
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5a6078]">Route</span>
                    <span className="text-white font-bold">
                      {quote.routePlan?.length ?? 0} hop{(quote.routePlan?.length ?? 0) !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5a6078]">Slippage</span>
                    <span className="text-white font-bold">0.5%</span>
                  </div>
                </div>
              )}

              {/* Errors */}
              {quoteError && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{quoteError}</span>
                </div>
              )}
              {swapError && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{swapError}</span>
                </div>
              )}

              {/* Success */}
              {swapSuccess && (
                <div className="mt-2 rounded-lg border border-[#00FFA3]/20 bg-[#00FFA3]/5 px-3 py-2 text-xs text-[#00FFA3]">
                  <span className="font-bold">Swap successful! </span>
                  <a
                    href={`https://solscan.io/tx/${swapSuccess}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-white transition-colors"
                  >
                    View on Solscan →
                  </a>
                </div>
              )}

              {/* Swap button */}
              <button
                onClick={() => void handleSwap()}
                disabled={!quote || swapping || quoteLoading}
                className={`mt-4 w-full py-4 rounded-xl text-base font-bold uppercase tracking-wider transition-all active:scale-[0.98] ${
                  !quote || swapping || quoteLoading
                    ? "bg-[#1a1f2e] text-[#5a6078] cursor-not-allowed"
                    : "bg-[#00FFA3] text-black shadow-[0_4px_14px_0_rgba(0,255,163,0.3)] hover:bg-[#33ffb5] hover:shadow-[0_4px_20px_0_rgba(0,255,163,0.45)]"
                }`}
              >
                {swapping ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Swapping…
                  </span>
                ) : !inputMint || !outputMint ? (
                  "Select tokens"
                ) : !inputAmount || Number(inputAmount) <= 0 ? (
                  "Enter amount"
                ) : quoteLoading ? (
                  "Fetching quote…"
                ) : !quote ? (
                  "Get a quote"
                ) : (
                  "Swap"
                )}
              </button>
            </div>
          </div>

          {/* Powered by Jupiter */}
          <div className="mt-4 text-center text-[10px] text-[#3a4058]">
            Powered by <a href="https://jup.ag" target="_blank" rel="noopener noreferrer" className="text-[#5a6078] hover:text-white transition-colors">Jupiter Aggregator</a>
          </div>
        </div>
      </div>

      {/* Token picker */}
      {pickerFor && (
        <TokenPicker
          tokens={tokenList}
          onSelect={handlePickerSelect}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
