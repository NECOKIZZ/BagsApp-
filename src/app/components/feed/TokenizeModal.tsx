import { useEffect, useState } from "react";

export type TokenizeModalProps = {
  open: boolean;
  narrative: string;
  suggestedName: string;
  onClose: () => void;
  onLaunch: (payload: { name: string; ticker: string; liquiditySol: string }) => void;
};

export function TokenizeModal({
  open,
  narrative,
  suggestedName,
  onClose,
  onLaunch,
}: TokenizeModalProps) {
  const [name, setName] = useState(suggestedName);
  const [ticker, setTicker] = useState(suggestedName.slice(0, 4).toUpperCase());
  const [liquiditySol, setLiquiditySol] = useState("0.5");

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setTicker(suggestedName.slice(0, 4).toUpperCase());
    }
  }, [open, suggestedName]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tokenize-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="tokenize-modal-title" className="text-lg font-bold text-white">
          Launch token
        </h2>
        <p className="mt-1 text-sm text-zinc-400 leading-relaxed">Narrative: {narrative}</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Token name</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. RWASOLANA"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Ticker</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. RWAS"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Initial liquidity (SOL)</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              type="number"
              min={0.1}
              step={0.1}
              value={liquiditySol}
              onChange={(e) => setLiquiditySol(e.target.value)}
              placeholder="0.5"
            />
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-600 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onLaunch({ name: name.trim(), ticker: ticker.trim(), liquiditySol })}
            className="flex-[1.4] rounded-lg bg-white py-2.5 text-sm font-bold text-black hover:bg-zinc-200 transition-colors"
          >
            Launch on Bags
          </button>
        </div>
      </div>
    </div>
  );
}
