import { createBrowserRouter } from "react-router";
import { LandingPage } from "./pages/LandingPage";
import { FeedPage } from "./pages/FeedPage";
import { ProfilePage } from "./pages/ProfilePage";
import { TokenizePage } from "./pages/TokenizePage";
import { TokenDetailPage } from "./pages/TokenDetailPage";
import { SwapPage } from "./pages/SwapPage";
import { Layout } from "./components/Layout";

export const router = createBrowserRouter([
  { path: "/", Component: LandingPage },
  {
    path: "/",
    Component: Layout,
    children: [
      { path: "feed", Component: FeedPage },
      { path: "profile", Component: ProfilePage },
      { path: "tokenize", Component: TokenizePage },
      { path: "token/:mint", Component: TokenDetailPage },
      { path: "swap", Component: SwapPage },
    ],
  },
]);