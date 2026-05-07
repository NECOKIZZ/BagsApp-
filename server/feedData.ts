/** Canonical feed payload — served by GET /api/feed */

export type FeedToken = {
  rank: number;
  icon: string;
  name: string;
  match: number;
  marketCap: string;
  returns: string;
  score: number;
};

export type FeedTweet = {
  avatar: string;
  avatarColor: string;
  avatarUrl?: string;
  name: string;
  handle: string;
  time: string;
  tweet: string;
  keywords: string[];
  likes: string;
  retweets: string;
  views: string;
  narrative: string;
  image?: string;
  tokens: FeedToken[];
};

export const feedTweets: FeedTweet[] = [
  {
    avatar: "MR",
    avatarColor: "#B5D4F4",
    avatarUrl: "/creators/murad_m.png",
    name: "Murad",
    handle: "@murad_m",
    time: "2m ago",
    tweet:
      "The next big narrative is RWA tokenization on Solana. BlackRock quietly building infra. This is the catalyst everyone's been waiting for. Accumulate early.",
    keywords: ["RWA", "BlackRock", "catalyst"],
    likes: "4.2k",
    retweets: "891",
    views: "312",
    narrative: "RWA tokenization on Solana",
    image:
      "https://images.unsplash.com/photo-1631864032173-c2f015fe3459?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxibG9ja2NoYWluJTIwdGVjaG5vbG9neSUyMG5ldHdvcmt8ZW58MXx8fHwxNzc1MDUxMDY0fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    tokens: [
      {
        rank: 1,
        icon: "RW",
        name: "RWASOLANA",
        match: 98,
        marketCap: "$2.1M",
        returns: "+840%",
        score: 88,
      },
      {
        rank: 2,
        icon: "BK",
        name: "BLACKROCKFI",
        match: 91,
        marketCap: "$890K",
        returns: "+340%",
        score: 71,
      },
      {
        rank: 3,
        icon: "CT",
        name: "CATALYST",
        match: 86,
        marketCap: "$210K",
        returns: "-22%",
        score: 44,
      },
    ],
  },
  {
    avatar: "AB",
    avatarColor: "#F5C4B3",
    avatarUrl: "/creators/blknoiz06.png",
    name: "ansem",
    handle: "@blknoiz06",
    time: "7m ago",
    tweet:
      "DePIN is still incredibly early. Helium just crossed 1M nodes. The GPU network thesis plays out this cycle. Don't sleep on this sector.",
    keywords: ["DePIN", "GPU"],
    likes: "2.8k",
    retweets: "540",
    views: "198",
    narrative: "DePIN GPU network",
    image:
      "https://images.unsplash.com/photo-1659010878130-ae8b703bd3ee?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcnlwdG9jdXJyZW5jeSUyMGJpdGNvaW58ZW58MXx8fHwxNzc1MDU1ODU3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
    tokens: [
      {
        rank: 1,
        icon: "DP",
        name: "DEPINGEN",
        match: 93,
        marketCap: "$560K",
        returns: "+190%",
        score: 79,
      },
      {
        rank: 2,
        icon: "GP",
        name: "GPUNETWORK",
        match: 81,
        marketCap: "$142K",
        returns: "+67%",
        score: 54,
      },
    ],
  },
  {
    avatar: "KT",
    avatarColor: "#9FE1CB",
    avatarUrl: "/creators/kaitoai.png",
    name: "kaito",
    handle: "@kaitoai",
    time: "14m ago",
    tweet:
      "Everyone's sleeping on AI agents with on-chain wallets. Autonomous trading is coming faster than people expect. The infrastructure play is already here.",
    keywords: ["AI agents", "Autonomous"],
    likes: "1.1k",
    retweets: "220",
    views: "87",
    narrative: "AI agents autonomous trading",
    tokens: [],
  },
  {
    avatar: "CB",
    avatarColor: "#FAC775",
    avatarUrl: "/creators/cobie.png",
    name: "cobie",
    handle: "@cobie",
    time: "28m ago",
    tweet:
      "Restaking yields are compressing but the liquidity flywheel is just getting started. EigenLayer operators going live changes everything.",
    keywords: ["Restaking", "liquidity", "EigenLayer"],
    likes: "3.4k",
    retweets: "710",
    views: "244",
    narrative: "Restaking EigenLayer",
    tokens: [
      {
        rank: 1,
        icon: "EL",
        name: "EIGENLAYER",
        match: 95,
        marketCap: "$1.3M",
        returns: "+520%",
        score: 83,
      },
    ],
  },
];

export type FeedFilter = "all" | "noTokens" | "highScore";

export function applyFeedFilter(tweets: FeedTweet[], filter: FeedFilter): FeedTweet[] {
  if (filter === "noTokens") return tweets.filter((t) => t.tokens.length === 0);
  if (filter === "highScore") return tweets.filter((t) => t.tokens.some((x) => x.score >= 75));
  return tweets;
}
