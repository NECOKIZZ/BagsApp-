import { Link, useLocation } from "react-router";

export function BottomNav() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "FEED" },
    { path: "/profile", label: "PORTFOLIO" },
  ];

  return (
    <nav className="bg-[#05070B] border-t border-[#1a1f2e] z-50">
      <div className="flex items-center justify-center gap-0">
        {navItems.map(({ path, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`relative px-6 py-3 text-xs font-bold tracking-widest transition-all ${
                isActive
                  ? "text-[#00FFA3] border-t-2 border-[#00FFA3] -mt-px shadow-[0_-8px_20px_rgba(0,255,163,0.12)]"
                  : "text-[#5a6078] hover:text-[#8b92a8]"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}