import { Link, useLocation } from "react-router";
import { LayoutGrid, Users, Wallet } from "lucide-react";

export function BottomNav() {
  const location = useLocation();
  
  const navItems = [
    { path: "/", icon: LayoutGrid, label: "Feed" },
    { path: "/creators", icon: Users, label: "Creators" },
    { path: "/profile", icon: Wallet, label: "Profile" },
  ];

  return (
    <nav className="fixed bottom-4 left-0 right-0 flex justify-center px-4 pb-safe pointer-events-none z-50">
      <div className="bg-black border border-gray-700 rounded-full shadow-2xl flex items-center gap-1 p-2 pointer-events-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`relative flex items-center justify-center p-3 rounded-full transition-all group ${
                isActive 
                  ? "bg-white text-black shadow-lg" 
                  : "text-gray-500 hover:text-gray-300"
              }`}
              title={label}
            >
              <Icon className="w-5 h-5" />
              
              {/* Hover Label */}
              <span className="absolute bottom-full mb-2 px-3 py-1.5 bg-white text-black text-xs font-bold rounded-full whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none shadow-lg">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}