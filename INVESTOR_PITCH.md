# Delphi — Investor Documentation

> **The Command Center for Solana Memecoin Discovery & Launch**
> 
> *Turn Twitter alpha into actionable token intelligence. Launch, monitor, and trade — all from one dashboard.*

---

## 1. Executive Summary

Delphi is an AI-powered intelligence platform that monitors crypto Twitter ("CT") in real-time, extracts token mentions, enriches them with on-chain data, and presents them in a unified, actionable feed. Users can discover emerging tokens before they trend, analyze their fundamentals via our proprietary scoring algorithm, and — uniquely — launch their own tokens directly through the app via integrated launchpad partners.

**The Problem:**
- Crypto Twitter generates millions of token mentions daily. Sifting through noise to find signal is a full-time job.
- Most traders miss the first 10-30 minutes of a token's life — the window where the majority of gains are made.
- Launching a token requires navigating multiple platforms (Pump.fun, Bags, Jupiter), each with different UIs, wallets, and fee structures.
- There is no single dashboard that combines social signal detection, on-chain analytics, token launching, and portfolio tracking.

**Our Solution:**
- **Real-time Feed Engine:** Monitors a curated list of alpha-generating Twitter accounts, extracts token mentions using NLP, and scores them based on creator reputation, token fundamentals, and market momentum.
- **Market Terminal:** A Bloomberg-style terminal showing tokens sorted by age, momentum, and whether they were launched natively on Delphi.
- **Native Token Launch:** Users can launch SPL tokens directly through Delphi with configurable liquidity, built-in fee sharing, and automatic social amplification.
- **Integrated Trading:** One-click token swaps via Jupiter Terminal embedded directly in the app — no tab-switching.
- **Portfolio Tracking:** Real-time wallet holdings with P&L, entry prices, and quick swap actions.

**Traction (Current):**
- [Number] Twitter accounts actively monitored
- [Number] tokens discovered and scored
- [Number] tokens launched through the platform
- [Number] active wallets connected
- [Number] daily feed views

**The Ask:**
We are raising [Amount] to accelerate growth, expand our monitored account network, build out auto-trading agents, and scale infrastructure.

---

## 2. Product Overview

### 2.1 The Feed

The core of Delphi is the **Feed** — a reverse-chronological stream of curated tweets from high-signal crypto accounts. Unlike generic Twitter lists, every tweet is enriched:

- **Token Extraction:** NLP pipeline identifies and extracts token mentions (tickers, mint addresses, CA strings) from tweet text.
- **Token Scoring:** Each discovered token receives a composite score (0-100) based on:
  - Creator track record (historical performance of tokens they've mentioned)
  - Token fundamentals (market cap, volume, age, holder count)
  - Narrative alignment (how well the token fits current market meta)
  - Social velocity (engagement rate, retweet speed)
- **One-Click Actions:** From any tweet, users can view token details, swap via Jupiter, or launch a competing token.

**Feed Stats (Real-Time):**
- X Twitter accounts being tracked
- X tokens launched in-app
- X tokens being monitored

### 2.2 Market Terminal

A dedicated side panel (desktop) or full-screen view (mobile) that functions as a trading terminal:

- **YOUNG:** Tokens launched within the last 7 days, sorted by recency.
- **OLD:** Established tokens (7+ days), sorted by composite score.
- **MY APP:** Tokens launched directly through Delphi — our native launchpad track.

Each row shows: token name/ticker, market cap, 24h volume, 24h returns, composite score, launch platform badge (Bags/Pump.fun), and a BUY button.

### 2.3 Tokenize (Launchpad)

Users can launch an SPL token in under 60 seconds:

1. **Compose Narrative:** Describe the token's concept/story.
2. **Configure:** Name, ticker symbol, liquidity amount (in SOL), optional image.
3. **Sign & Launch:** Connect Phantom wallet, review the transaction, and sign. The token is minted, liquidity is added, and the token is immediately tradeable on Jupiter.
4. **Share:** Post-launch, users are prompted to "Shill" — a pre-composed reply to the original tweet containing the token's contract address.

**Launch Integration:** Delphi integrates with the Bags launchpad API for token creation and the Jupiter swap infrastructure for immediate liquidity and trading.

### 2.4 Token Detail Pages

Deep-dive pages for any token in the feed or terminal:

- **Header:** Token name, ticker, mint address (copyable), price, 24h change, market cap.
- **Metrics Panel:** Volume, liquidity, holder count, top holders distribution, age.
- **Feed Mentions:** All tweets that mentioned this token, with context.
- **Actions:** Buy/Sell via integrated Jupiter swap modal.

### 2.5 Portfolio (Profile Page)

Connected wallets display:

- **SOL Balance:** Real-time SOL balance.
- **Token Holdings:** All SPL tokens with current USD value, P&L, and quick actions (buy/sell).
- **Transaction History:** Recent swaps and token launches.

---

## 3. Architecture

### 3.1 High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Feed Page  │  │  Terminal   │  │  Tokenize   │  │  Profile/Wallet │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                │                   │         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    React 19 + TypeScript + Vite                  │   │
│  │  State: React Hooks  |  Routing: React Router  |  Styling: Tailwind│ │
│  │  Icons: Lucide React  |  HTTP: Native Fetch  |  Solana: @solana/*  │ │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     API CLIENT (lib/api.ts)                     │   │
│  │  Feed fetching  |  Terminal data  |  Launch requests  |  Wallet   │   │
│  └─────────────────────────────┬───────────────────────────────────┘   │
└────────────────────────────────│───────────────────────────────────────┘
                                 │
                                 │ HTTPS / JSON
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              API SERVER                                  │
│                    Node.js + Express + TypeScript                        │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  /api/feed  │  │ /api/term.  │  │/api/launches│  │/api/metrics │   │
│  │  GET        │  │  GET        │  │  POST       │  │  GET        │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │                   │         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Data Access Layer (Supabase/PostgreSQL)       │   │
│  │                                                                  │   │
│  │  tweets          │  narrative_tokens  │  creators  │  metrics  │   │
│  │  ──────          │  ───────────────   │  ────────  │  ───────  │   │
│  │  id              │  id                │  id        │  token_id │   │
│  │  content         │  token_name        │  handle    │  price    │   │
│  │  posted_at       │  token_ticker      │  followers │  mcap     │   │
│  │  creator_id      │  token_mint        │  accuracy  │  volume   │   │
│  │  narrative       │  match_score       │  score     │  returns  │   │
│  │  image_url       │  current_mcap      │            │  holders  │   │
│  │  tokens[]        │  total_volume      │            │           │   │
│  │                  │  is_on_bags        │            │           │   │
│  │                  │  launched_here     │            │           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Background Jobs (Cron):                                               │
│  • refreshBagsTokenStatsOnce() — updates mcap, volume, returns         │
│  • Twitter ingestion pipeline — fetches new tweets, extracts tokens      │
│  • Scoring engine — recalculates token & creator scores                │
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ RPC / REST
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL INTEGRATIONS                          │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   Twitter   │  │   Bags      │  │   Jupiter   │  │   Solana    │   │
│  │   API v2    │  │   Launchpad │  │   Swap      │  │   RPC /     │   │
│  │             │  │   API       │  │   Terminal  │  │   Phantom   │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                          │
│  • Tweet ingestion    • Token minting    • Swap routing   • Wallet     │
│  • Creator profiles   • Fee sharing      • Price data     • Tx signing │
│  • Sentiment data     • Liquidity add    • Token lists    • Balance    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Frontend Architecture

**Framework:** React 19 with TypeScript (strict mode)
**Build Tool:** Vite (fast dev server, optimized production builds)
**Styling:** Tailwind CSS v4 with custom design tokens
**Routing:** React Router v7 (declarative, nested routes)
**State Management:** React Hooks (`useState`, `useReducer`, `useMemo`, `useCallback`) — no external state library needed given the app's data flow complexity. Server state is fetched fresh on route changes and cached in component memory.
**Icons:** Lucide React (tree-shakeable, consistent style)
**Solana Integration:** `@solana/web3.js` for RPC calls, `@solana/wallet-adapter-react` for wallet connection abstraction

**Component Hierarchy:**
```
Layout.tsx (error boundary, global structure)
├── FeedPage.tsx
│   ├── MarketTerminal.tsx (sidebar terminal)
│   ├── TweetCard.tsx (individual tweet + tokens)
│   │   └── SwapModal.tsx (Jupiter iframe overlay)
│   └── TokenDetailPage.tsx (deep-dive route)
├── ProfilePage.tsx (wallet holdings)
├── TokenizePage.tsx (launch flow)
└── NavButtons.tsx (navigation)
```

### 3.3 Backend Architecture

**Runtime:** Node.js 20+ with Express.js
**Language:** TypeScript (compiled to `dist/`)
**Database:** Supabase (managed PostgreSQL) with Row-Level Security
**Authentication:** Self-custody wallet auth — users sign a nonce with their Phantom wallet, server verifies the signature using `@solana/web3.js`, and issues a JWT bearer token.
**Cron Jobs:** Node-cron for background data refresh

**Key API Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/feed` | GET | Returns enriched tweets with extracted tokens, sorted by recency. Supports filtering (all, no tokens, high score). |
| `/api/terminal` | GET | Returns tokens categorized into YOUNG, OLD, and MY APP tracks. |
| `/api/launches` | POST | Initiates a token launch. Validates wallet auth, constructs the launch transaction, and returns launch status + token mint. |
| `/api/metrics/:mint` | GET | Returns real-time on-chain metrics for a specific token (price, mcap, volume, holders). |
| `/api/auth/nonce` | GET | Returns a signable nonce for wallet authentication. |
| `/api/auth/verify` | POST | Verifies signed nonce and issues JWT. |
| `/api/auth/session` | GET | Validates current JWT session. |

**Data Pipeline:**

1. **Ingestion:** Cron job fetches tweets from monitored accounts via Twitter API v2.
2. **Extraction:** NLP pipeline scans tweet text for token tickers, mint addresses, and contract addresses.
3. **Enrichment:** For each discovered token, query on-chain data (Jupiter token list, Solana RPC for holder count, Bags API for platform status).
4. **Scoring:** Weighted algorithm produces a 0-100 composite score based on creator history, token fundamentals, and social velocity.
5. **Storage:** Normalized data stored in Supabase (tweets → tokens → creators → metrics).
6. **Serving:** API endpoints query the database and return pre-computed, cached responses.

### 3.4 Database Schema (PostgreSQL / Supabase)

**`tweets` table:**
- `id` (UUID, PK)
- `content` (TEXT) — raw tweet text
- `posted_at` (TIMESTAMPTZ) — tweet timestamp
- `creator_id` (UUID, FK → creators)
- `narrative` (TEXT) — AI-classified narrative/theme
- `image_url` (TEXT, nullable)
- `link_preview` (JSONB, nullable)
- `narrative_tokens` (JSONB) — array of extracted token objects

**`narrative_tokens` (embedded in tweets JSONB):**
- `token_name` (TEXT)
- `token_ticker` (TEXT)
- `token_mint` (TEXT)
- `match_score` (FLOAT)
- `current_mcap` (FLOAT)
- `total_volume` (FLOAT)
- `current_price` (FLOAT)
- `returns` (TEXT)
- `score` (FLOAT)
- `launched_at` (TIMESTAMPTZ)
- `is_on_bags` (BOOLEAN)
- `launched_here` (BOOLEAN) — true if launched via Delphi

**`creators` table:**
- `id` (UUID, PK)
- `handle` (TEXT, unique) — Twitter handle
- `display_name` (TEXT)
- `followers` (INTEGER)
- `accuracy_score` (FLOAT) — historical token call accuracy
- `avg_roi` (FLOAT) — average ROI of tokens they've mentioned

**`token_metrics` table:**
- `token_id` (TEXT, PK) — mint address
- `price_usd` (FLOAT)
- `market_cap_usd` (FLOAT)
- `volume_24h` (FLOAT)
- `holders` (INTEGER)
- `updated_at` (TIMESTAMPTZ)

---

## 4. Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI framework |
| TypeScript | 5.7 | Type safety |
| Vite | 6.x | Build tool / dev server |
| Tailwind CSS | 4.x | Utility-first styling |
| React Router | 7.x | Client-side routing |
| Lucide React | latest | Iconography |
| @solana/web3.js | 1.x | Solana blockchain interaction |
| @solana/wallet-adapter-react | latest | Wallet connection UI |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20+ | Runtime |
| Express | 4.x | HTTP server framework |
| TypeScript | 5.7 | Type safety |
| Supabase (PostgreSQL) | latest | Primary database |
| node-cron | latest | Background job scheduling |
| dotenv | latest | Environment configuration |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Vercel | Frontend hosting + CDN + edge functions |
| Railway | Backend API hosting (Node.js + Express) |
| Supabase | Managed PostgreSQL + Auth + Realtime |

### Third-Party APIs
| Service | Purpose |
|---------|---------|
| Twitter API v2 | Tweet ingestion, creator metadata |
| Bags Launchpad API | Token minting, liquidity provision, fee sharing |
| Jupiter API | Swap routing, token prices, token metadata |
| Solana RPC (Helius/QuickNode) | On-chain data (balances, transactions, token accounts) |
| Phantom Wallet | User wallet connection & transaction signing |

---

## 5. Key Integrations

### 5.1 Twitter / X API
- **Endpoint:** `GET /2/users/:id/tweets` for monitored accounts
- **Rate Limits:** 1500 requests per 15 minutes (Basic tier), 300 per 15 minutes (Free tier)
- **Data Fetched:** Tweet text, media URLs, engagement metrics, timestamps
- **Processing:** Content is parsed for token tickers (regex matching `$[A-Z]+` patterns), mint addresses (base58 32-44 chars), and contract address strings. NLP classification assigns a narrative/theme to each tweet.

### 5.2 Bags Launchpad
- **Endpoint:** `POST /api/launches` (internal) → Bags API
- **Flow:**
  1. User fills tokenize form (name, ticker, liquidity, image, narrative)
  2. Server constructs a launch transaction via Bags SDK
  3. Transaction is returned to frontend for wallet signing
  4. Signed transaction is submitted to Solana
  5. Token mint is generated, liquidity is added to Jupiter
  6. Server records `launched_here = true` in database
- **Fee Structure:** Bags takes a platform fee; Delphi takes a referral/launch fee.

### 5.3 Jupiter Swap Terminal
- **Integration Type:** Iframe embed + SDK
- **Features:**
  - Route optimization (splits across multiple DEXs for best price)
  - Slippage protection
  - Token list auto-discovery
- **UI:** Modal overlay (`SwapModal.tsx`) triggered from any BUY/SELL button across the app

### 5.4 Solana Wallet Authentication
- **Method:** Challenge-response signature
- **Flow:**
  1. Frontend requests nonce from `/api/auth/nonce`
  2. User signs nonce with Phantom wallet
  3. Signature + public key sent to `/api/auth/verify`
  4. Server verifies signature using `solana/web3.js` `verify()`
  5. JWT issued, stored in `localStorage`
- **Security:** No password database. Users control their own keys. Server never sees private keys.

---

## 6. Business Model & Revenue Streams

### 6.1 Current Revenue
- **Launch Fees:** Fee collected on every token launched through Delphi (percentage of liquidity or flat fee)
- **Swap Referral:** Jupiter's referral program provides a small percentage of swap volume routed through our UI

### 6.2 Planned Revenue
- **Premium Subscriptions:**
  - **Free Tier:** Basic feed, 50 monitored accounts, delayed data (5-min lag)
  - **Pro Tier ($29/mo):** Real-time feed, unlimited accounts, advanced filters, watchlists, exportable data
  - **Whale Tier ($99/mo):** Everything in Pro + auto-buy agents, API access, custom alerts, priority support
- **Advertising / Promoted Tokens:** Token creators can pay for featured placement in the feed or terminal
- **Creator Revenue Share:** When a creator launches a token through Delphi, they earn a share of launch fees. This incentivizes creators to use our platform exclusively.
- **Data API:** Sell aggregated feed data and sentiment scores to hedge funds and quant traders

### 6.3 Unit Economics (Projected)
- **Average Launch Fee:** $50-200 per token (depending on liquidity)
- **Average Swap Volume per User:** $5,000/month
- **Swap Referral Rate:** 0.1-0.3% of volume
- **LTV/CAC Target:** 3:1 ratio

---

## 7. Competitive Landscape

| Competitor | What They Do | Our Differentiation |
|------------|--------------|---------------------|
| **DexScreener** | Token price charts, new pairs | We discover tokens *before* they're on DEXes via social signal |
| **TweetScout** | Twitter analytics for crypto | We integrate trading + launching, not just monitoring |
| **Pump.fun** | Token launching | We aggregate multiple launchpads + provide discovery feed |
| **BullX** | Memecoin trading bot | We have a curated feed + human-readable scoring, not just bots |
| **Kaito AI** | AI-powered crypto Twitter analytics | We're focused on actionable trading + launching, not just data |

**Our Moat:**
1. **Integrated Loop:** No competitor combines discovery → analysis → trading → launching in one interface.
2. **Creator Scoring:** Our proprietary algorithm tracks creator accuracy over time, surfacing only high-signal accounts.
3. **Native Launchpad:** Tokens launched through Delphi get automatic feed placement and social amplification.
4. **Wallet-Native UX:** No email/password. Connect Phantom, start trading. Friction is minimal.

---

## 8. Future Roadmap

### Q2 2025 (Current — Build)
- [x] Core feed with token extraction
- [x] Market Terminal (Young / Old / My App)
- [x] Token launch via Bags integration
- [x] Jupiter swap modal
- [x] Wallet authentication
- [x] Mobile-responsive UI
- [ ] Pull-to-refresh on mobile feed
- [ ] Post-launch success modal with "Shill" button
- [ ] Creator profile pages

### Q3 2025 (Scale)
- **Auto-Buy Agents:** Users configure rules ("Buy any token from @handle_xyz with score >80 and mcap <$1M"). Agents monitor the feed 24/7 and execute swaps automatically via session-signed transactions.
- **Alert System:** Browser push notifications + Telegram bot for high-score tokens, price thresholds, and creator activity.
- **Advanced Filtering:** Search by ticker, creator, narrative, market cap range. Saved filter sets.
- **Watchlists:** Personal bookmarked tokens with price alerts.

### Q4 2025 (Monetize)
- **Premium Tiers:** Pro and Whale subscription plans with tiered features.
- **Promoted Tokens:** Sponsored placement in feed and terminal.
- **Analytics Dashboard:** For token creators — holder distribution, trading volume over time, top buyers, social reach metrics.
- **API Access:** REST API for third-party developers to access our feed and scoring data.

### 2026 (Expand)
- **Multi-Chain:** Expand beyond Solana to Base, Ethereum L2s, Sui.
- **Social Features:** Comment threads on tokens, community leaderboards, creator verification badges.
- **Mobile App:** React Native or PWA with native push notifications and biometric auth.
- **Institutional Data:** Sell aggregated sentiment and early-discovery data to quant funds and market makers.

---

## 9. Team

**[Founder Name]** — CEO & Full-Stack Engineer
- Built Delphi from concept to production as a solo founder
- Background in [relevant field: e.g., quantitative trading, full-stack engineering, crypto community building]
- [Any notable achievements, previous exits, or community credibility]

**Advisors:**
- [Name] — [Role, e.g., former PM at Coinbase, DeFi protocol founder]
- [Name] — [Role, e.g., crypto VC, trading firm partner]

*We are actively hiring:*
- Senior Backend Engineer (Rust/Node, Solana programs)
- Growth Lead (community, partnerships, influencer outreach)
- UX Designer (mobile-first, trading interface specialization)

---

## 10. Use of Funds

| Category | Allocation | Purpose |
|----------|-----------|---------|
| **Engineering** | 40% | Hire 2 senior engineers, build auto-buy agents, scale infrastructure |
| **Growth & Marketing** | 25% | Influencer partnerships, Twitter ads, community events, content creation |
| **Operations** | 15% | Supabase/Railway scaling, RPC node costs, API rate limit upgrades |
| **Legal & Compliance** | 10% | Token launch compliance, terms of service, regulatory consultation |
| **Reserve** | 10% | Emergency fund, opportunistic partnerships |

---

## 11. Key Metrics & KPIs

We track the following metrics weekly:

| Metric | Current | 6-Month Target |
|--------|---------|--------------|
| Monitored Twitter Accounts | X | 500+ |
| Tokens Discovered | X | 10,000+ |
| Tokens Launched In-App | X | 500+ |
| MAU (Monthly Active Wallets) | X | 5,000+ |
| Daily Feed Views | X | 50,000+ |
| Avg. Time on App | X | 12+ min |
| Launch Revenue | X | $50K+ |
| Swap Volume Facilitated | X | $10M+ |

---

## 12. Risk Factors & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Twitter API rate limits / shutdown | Medium | High | Maintain multiple API keys, build scraper fallback, diversify to other social platforms (Farcaster, Lens) |
| Solana network congestion | Medium | Medium | Use priority fees, integrate multiple RPC providers (Helius, QuickNode, Triton) |
| Regulatory scrutiny on token launches | Medium | High | Implement geoblocking, KYC for launchers, legal compliance framework, terms of service |
| Competitor copycats | High | Medium | Move fast on roadmap, build community moat, creator lock-in via revenue sharing |
| Smart contract exploits | Low | Critical | Use audited launchpad partners (Bags), do not write custom smart contracts |
| Key person dependency (solo founder) | Medium | High | Document everything, hire senior engineers, establish advisory board |

---

## 13. Appendix: Technical Deep Dives

### 13.1 Token Scoring Algorithm

The composite score (0-100) is calculated as:

```
score = (
  creator_accuracy_weight  * creator_accuracy_score +
  market_momentum_weight   * market_momentum_score +
  social_velocity_weight   * social_velocity_score +
  narrative_strength_weight * narrative_strength_score
)
```

Where each sub-score is normalized to 0-100:
- **Creator Accuracy:** Historical win rate of tokens mentioned by this creator (weighted by recency)
- **Market Momentum:** Rate of change in market cap, volume, and holder count over 1h, 6h, 24h
- **Social Velocity:** Engagement rate (likes + retweets per follower) on the tweet that mentioned the token
- **Narrative Strength:** How many other high-score creators are talking about the same narrative/theme

### 13.2 Feed Ingestion Pipeline

```
Cron (every 2 minutes)
  → Fetch new tweets from monitored accounts
  → Filter: only tweets with token mentions
  → NLP: classify narrative/theme
  → Enrichment: query Jupiter API for token metadata
  → Scoring: run composite score algorithm
  → Storage: insert into Supabase
  → Cache: invalidate Vercel edge cache
```

### 13.3 Wallet Auth Flow (Detailed)

```
Frontend                          Backend
  |                                  |
  |--- GET /api/auth/nonce -------->|
  |<-- { nonce: "abc123..." } -----|
  |                                  |
  | [User signs nonce with Phantom] |
  |                                  |
  |--- POST /api/auth/verify ------>| (signature, pubkey, nonce)
  |    { signature, pubkey, nonce } |
  |                                  |
  |    [Verify signature using      |
  |     nacl.sign.detached.verify   |
  |     against pubkey + nonce]     |
  |                                  |
  |<-- { token: "jwt..." } ---------|
  |                                  |
  | [Store JWT in localStorage]     |
  | [Attach to all future requests] |
```

### 13.4 Launch Transaction Flow

```
User (TokenizePage)
  |
  |--- POST /api/launches -------> Server
  |     { name, ticker, liquidity, tweet_id, wallet }
  |                                |
  |                                |---> Bags API
  |                                |     { create token + liquidity tx }
  |                                |<---- { unsigned tx, mint address }
  |                                |
  |<---- { launch: { token_mint, status } }
  |
  | [Phantom signs transaction]
  |
  |--- POST /api/launches/confirm -> Server
  |     { signed_tx, launch_id }
  |                                |
  |                                |---> Solana RPC
  |                                |     { submitTransaction }
  |                                |<---- { signature, confirmation }
  |                                |
  |<---- { success: true, signature, mint }
  |
  | [Show success modal]
```

---

## 14. Contact

**Founder:** [Your Name] | [your.email] | [Twitter/X handle]
**Company:** Delphi Labs
**Repository:** https://github.com/NECOKIZZ/BagsApp-
**Live App:** [Production URL]

---

*This document is confidential and intended for prospective investors and strategic partners. Do not distribute without express written permission.*
