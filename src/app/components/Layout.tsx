import { Outlet } from "react-router";
import { BottomNav } from "./BottomNav";

export function Layout() {
  return (
    <div className="flex flex-col h-screen bg-black">
      <div className="flex-1 overflow-hidden min-h-0">
        <Outlet />
      </div>
      <div className="shrink-0">
        <BottomNav />
      </div>
    </div>
  );
}