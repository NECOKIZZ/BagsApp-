import { useState, useCallback } from "react";
import { X } from "lucide-react";

interface SwapModalProps {
  inputMint?: string;
  outputMint?: string;
  trigger: React.ReactNode;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

export function SwapModal({ inputMint = SOL_MINT, outputMint, trigger }: SwapModalProps) {
  const [open, setOpen] = useState(false);

  const terminalUrl = `https://jup.ag/terminal?inputMint=${inputMint}&outputMint=${outputMint ?? SOL_MINT}&integrated=true`;

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <div onClick={handleOpen} className="cursor-pointer inline-flex">
        {trigger}
      </div>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-[480px] h-[600px] max-h-[85vh] rounded-2xl border border-[#1a1f2e] bg-[#0B0F17] shadow-[0_0_60px_rgba(0,255,163,0.08)] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1a1f2e] bg-[#05070B]/60">
              <span className="text-xs font-bold uppercase tracking-wider text-[#8b92a8]">
                Swap
              </span>
              <button
                onClick={handleClose}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-[#1a1f2e] bg-[#0B0F17] text-[#8b92a8] hover:text-white hover:border-[#242b3d] transition-all"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Jupiter Terminal iframe */}
            <iframe
              src={terminalUrl}
              title="Jupiter Terminal"
              className="flex-1 w-full border-0"
              allow="clipboard-write"
            />
          </div>
        </div>
      )}
    </>
  );
}
