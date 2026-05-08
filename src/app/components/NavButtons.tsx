import { Link, useLocation } from "react-router";
import { Home, Wallet } from "lucide-react";

/**
 * Centered FEED / PORTFOLIO nav buttons.
 * Renders both a desktop absolute-centered variant and a compact mobile
 * inline variant so the buttons stay visible on every screen size.
 *
 * Usage: drop once inside the top-bar flex row. It positions itself.
 */
export function NavButtons() {
  const location = useLocation();
  const isFeed = location.pathname === "/" || location.pathname === "/feed";
  const isProfile = location.pathname === "/profile";

  const desktopBase =
    "btn-font px-5 py-2 text-sm font-bold tracking-widest rounded-lg transition-all";
  const desktopActive =
    "bg-[#00FFA3] text-black shadow-[0_0_20px_rgba(0,255,163,0.35)] scale-105";
  const desktopIdle =
    "bg-[#0B0F17] text-[#8b92a8] border border-[#1a1f2e] hover:border-[#242b3d] hover:text-white hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]";

  const mobileBase =
    "btn-font px-2 py-1 text-[10px] font-bold tracking-widest rounded-md transition-all";
  const mobileActive =
    "bg-[#00FFA3] text-black shadow-[0_0_12px_rgba(0,255,163,0.35)] scale-105";
  const mobileIdle =
    "bg-[#0B0F17] text-[#8b92a8] border border-[#1a1f2e] hover:border-[#242b3d] hover:text-white";

  return (
    <>
      {/* Desktop: centered absolute nav */}
      <div className="absolute inset-x-0 hidden sm:flex justify-center pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <Link to="/feed" className={`${desktopBase} ${isFeed ? desktopActive : desktopIdle}`}>
            FEED
          </Link>
          <Link
            to="/profile"
            className={`${desktopBase} ${isProfile ? desktopActive : desktopIdle}`}
          >
            PORTFOLIO
          </Link>
        </div>
      </div>

      {/* Mobile: icon-only nav, centered absolutely */}
      <div className="absolute inset-x-0 flex sm:hidden justify-center pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <Link
            to="/feed"
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${isFeed ? mobileActive : mobileIdle}`}
            title="Feed"
          >
            <Home className="w-4 h-4" />
          </Link>
          <Link
            to="/profile"
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${isProfile ? mobileActive : mobileIdle}`}
            title="Portfolio"
          >
            <Wallet className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </>
  );
}
