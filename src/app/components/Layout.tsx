import { Outlet } from "react-router";

export function Layout() {
  return (
    <div className="flex flex-col h-screen bg-[#05070B]">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_#0a1628_0%,_#05070B_50%,_#020305_100%)] pointer-events-none" />
      <div className="relative flex-1 overflow-hidden min-h-0">
        <Outlet />
      </div>
    </div>
  );
}