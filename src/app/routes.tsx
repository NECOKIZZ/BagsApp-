import { createBrowserRouter } from "react-router";
import { FeedPage } from "./pages/FeedPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CreatorsPage } from "./pages/CreatorsPage";
import { TokenizePage } from "./pages/TokenizePage";
import { TokensHeldPage } from "./pages/TokensHeldPage";
import { TokenDetailPage } from "./pages/TokenDetailPage";
import { Layout } from "./components/Layout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: FeedPage },
      { path: "profile", Component: ProfilePage },
      { path: "creators", Component: CreatorsPage },
      { path: "tokenize", Component: TokenizePage },
      { path: "tokens-held", Component: TokensHeldPage },
      { path: "token/:tokenId", Component: TokenDetailPage },
    ],
  },
]);