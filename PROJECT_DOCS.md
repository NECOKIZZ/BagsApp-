# BagsApp — Project Documentation

> **For the Project Engineer**  
> Last updated: 2026-04-29

---

## 1. Overview

BagsApp is a **real-time Twitter/X feed dashboard** with **Solana token launch integration** via [Bags](https://bags.fm). The app ingests tweets from tracked crypto accounts, identifies token-related narratives, and allows users to launch Solana tokens directly from the feed — complete with live market data (mcap, volume, price) pulled from Bags.

### Core Value Proposition
- Track influential crypto voices on X in real-time
- Identify trending token narratives before they blow up
- One-click tokenize any narrative into a tradable Solana token
- See live market data (mcap, volume, price) for launched tokens

---

## 2. Tech Stack

### Frontend (Client-Side)
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React 18 + TypeScript | UI layer |
| Bundler | Vite 6 | Dev server + production build |
| Router | React Router 7 | SPA navigation (Feed → Tokenize → Profile → etc.) |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Components | Radix UI (primitives) + shadcn/ui patterns | Accessible, unstyled primitives |
| Icons | Lucide React | Consistent iconography |
| Charts | Recharts | Token analytics visualizations |
| Carousel | Embla Carousel | Horizontal scrolling carousels |
| Wallet | Phantom (via `@solana/web3.js`) | Solana wallet connection + signing |

### Backend (Server-Side)
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 20 (via `tsx`) | TypeScript execution without compilation |
| Framework | Express 4 | HTTP API server |
| Database | Supabase (PostgreSQL + PostgREST) | Tweet storage, token metadata, launches |
| Tweet Source | twitterapi.io (webhook + REST) | Real-time tweet ingestion |
| Token Platform | Bags API v2 | Token creation, pool data, transaction signing |
| Auth | Session-less nonce+signature | Phantom wallet sign-message auth |

### DevOps / Deployment
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Backend Host | Railway.app | Docker-based Node.js hosting |
| Frontend Host | Vercel (planned) | Static site CDN |
| Container | Docker (Alpine + Node 20) | Production backend image |
| CI | GitHub + Railway auto-deploy | Push to main → auto-deploy |

---

## 3. Database Schema (Supabase)

### `creators` — Tracked Twitter accounts
```
id            uuid PRIMARY KEY
handle        text UNIQUE
display_name  text
avatar_url    text
follower_count integer
score         integer (0-100, influence score)
```

### `tweets` — Ingested tweets
```
id            uuid PRIMARY KEY
tweet_id      text UNIQUE (X status ID)
handle        text → FK to creators
content       text
type          text (tweet | repost | quote | comment)
image_url     text (nullable)
likes         integer
retweets      integer
replies       integer
views         integer
posted_at     timestamptz

+ narrative_tokens relationship (1 tweet → N tokens)
```

### `narrative_tokens` — Tokens linked to tweets
```
id              uuid PRIMARY KEY
tweet_id        text → FK to tweets (implicit)
token_name      text
token_ticker    text
token_mint      text (Solana mint address, nullable until launch)
current_mcap    numeric (USD market cap, updated by Bags refresher)
current_price   numeric (USD price, updated by Bags refresher)
total_volume    numeric (24h volume USD, updated by Bags refresher)
match_score     integer (0-100, narrative-to-token relevance)
score           integer (overall token score)
returns         text (e.g. "+12.5%")
launched_at     timestamptz
launched_here   boolean (launched via our app vs. external)
```

### `launches` — Token launch attempts
```
id                uuid PRIMARY KEY
tweet_id          text → FK to tweets
status            text (pending | fee_share | launched | failed)
token_name        text
token_ticker      text
wallet_address    text
initial_buy_lamports integer
launch_signature  text (Solana tx signature)
narrative         text
bags_state        jsonb ( Bags intermediate state )
created_at        timestamptz
```

---

## 4. App Pages & User Flow

```
┌─────────────┐    Tokenize    ┌─────────────┐
│   / (Feed)  │ ────────────→ │  /tokenize  │
│  Dashboard  │                │ Launch Form │
└──────┬──────┘                └──────┬──────┘
       │                              │
       │  Buy token                   │ Sign tx
       │  (Jupiter swap)              │ via Phantom
       ▼                              ▼
┌─────────────┐                ┌─────────────┐
│ /token/:id  │                │  /token/:id │
│ Token Detail│ ←──────────────│  Success    │
│  (Analytics)│                │  Redirect   │
└─────────────┘                └─────────────┘
       ▲
       │
┌──────┴──────┐
│ /profile    │ ← Wallet + holdings
│ /creators   │ ← Leaderboard of tracked accounts
│ /tokens-held│ ← User's token portfolio
└─────────────┘
```

### `/` — Feed (Home)
- **Live Twitter feed** from tracked accounts
- **Auto-refreshes silently every 30s** (pauses when tab hidden)
- **Skeleton loaders** while fetching
- **Filter dropdown**: 
  - Token-based: All / No tokens yet / High score
  - Type-based: Tweets only / Reposts / Quotes / Comments
- **Tweet cards** show: avatar, handle, time, type badge (TWEET/REPOST/QUOTE/COMMENT), content, image, engagement stats
- **Token rows** per tweet: icon, name, match %, score (color-coded), market cap, volume, returns, **Buy button** (→ Jupiter swap)
- **"View on X"** link per card (opens original tweet)
- **Connect Wallet** button in header (Phantom auth flow)

### `/tokenize` — Launch Token
- **Pre-filled** from feed: narrative text + suggested name
- **Form fields**: Token name, ticker (auto-uppercased, no $), description, supply, decimals, initial liquidity (SOL), image URL, website, Twitter, fee sharing toggle, ownership %
- **Real-time validation** against Bags rules (name ≤32, ticker ≤10, liquidity ≥0.21 SOL)
- **Wallet balance check** via Solana RPC (warns if < required SOL)
- **Multi-step signing flow**:
  1. Connect Phantom
  2. Auth (nonce + signMessage)
  3. Create token info on Bags
  4. Fee-share config (if enabled)
  5. Create launch transaction
  6. Sign + submit via Phantom
- **Progress indicator** with step labels
- **Success**: redirects to `/token/<name>`
- **Error handling** with actionable hints

### `/token/:tokenId` — Token Detail
- Token analytics (placeholder for full charts)
- Price history, market cap, volume
- Buy/sell interface (planned)

### `/profile` — User Profile
- Wallet address display
- Holdings overview
- Transaction history (planned)

### `/creators` — Creator Leaderboard
- List of tracked accounts with scores
- Follower counts, recent activity

### `/tokens-held` — Portfolio
- User's token holdings
- P&L tracking (planned)

---

## 5. Backend Architecture

### File Structure
```
server/
├── index.ts          # Main Express app (routes + jobs + server start)
├── bagsClient.ts     # Bags API v2 client (auth, token launch, pool data)
├── supabaseClient.ts # Supabase connection singleton
└── loadEnv.ts        # .env file loading + hot-reload helper
```

### API Endpoints

#### Public API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (Railway probe) |
| GET | `/api/feed?filter=all\|noTokens\|highScore` | Main feed with joined creators + tokens |
| POST | `/api/webhooks/twitterapi` | twitterapi.io webhook (tweet ingestion) |

#### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/nonce` | Generate auth nonce for wallet |
| POST | `/api/auth/verify` | Verify signed nonce → session token |
| GET | `/api/auth/session` | Validate session token |
| POST | `/api/auth/logout` | Invalidate session |

#### Token Launch
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/launches` | Start token launch (create-token-info + Supabase record) |
| POST | `/api/launches/:id/submit-tx` | Submit signed Solana transaction |

#### Admin (manual triggers)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/sync-monitors` | Sync twitterapi.io monitor with tracked handles |
| POST | `/api/admin/refresh-metrics` | Run metrics refresh manually |
| POST | `/api/admin/cleanup-tweets` | Run tweet retention cleanup |
| POST | `/api/admin/bags/refresh-tokens` | Run Bags token stats refresh manually |

### Background Jobs (all started on server boot)

#### 1. twitterapi.io Webhook Ingestion
- **Trigger**: Real-time POST from twitterapi.io
- **Process**: Parse tweet batch → classify type (tweet/repost/quote/comment) → upsert into `tweets` table
- **Deduplication**: `tweet_id` unique constraint
- **Auth**: `X-API-Key` header validated against `TWITTERAPI_WEBHOOK_KEY`

#### 2. Metrics Refresher
- **Trigger**: Every `METRICS_REFRESH_INTERVAL_MS` (default 5 min)
- **Scope**: Last `METRICS_REFRESH_LIMIT` tweets (default 20), younger than `METRICS_REFRESH_MAX_AGE_HOURS` (default 24h)
- **Process**: Call twitterapi.io GET `/twitter/tweets?tweet_ids=...` → update likes/retweets/replies/views
- **Cost**: ~15 credits per call. At default settings: ~4,320 calls/month ≈ 64,800 credits/year

#### 3. Bags Token Stats Refresher
- **Trigger**: Every `BAGS_REFRESH_INTERVAL_MS` (default 10 min)
- **Scope**: Up to `BAGS_REFRESH_LIMIT` tokens with `token_mint != null`
- **Process**: 
  1. Query `narrative_tokens` for mint addresses
  2. Call Bags `GET /solana/bags/pools/token-mint?tokenMint=<mint>`
  3. Parse pool response defensively (handles undocumented field names)
  4. Update `current_mcap`, `current_price`, `total_volume`

#### 4. Tweet Retention Cleanup
- **Trigger**: Every 24 hours
- **Process**: Delete tweets older than `TWEET_RETENTION_DAYS` (default 30)
- **Purpose**: Prevent unbounded table growth

---

## 6. Authentication Flow

Session-less **wallet signature auth** (no passwords, no sessions stored server-side):

```
┌─────────┐                    ┌──────────────┐
│ Frontend │ ── 1. Connect ─→ │ Phantom Wallet│
│         │                    └──────────────┘
│         │ ←──── publicKey ───┘
│         │
│         │ ── 2. POST /api/auth/nonce ──→ Backend
│         │                    (generates nonce, 5min TTL)
│         │ ←──── nonce + message ───────┘
│         │
│         │ ── 3. signMessage(message) ─→ Phantom
│         │ ←──── signature ──────────────┘
│         │
│         │ ── 4. POST /api/auth/verify ──→ Backend
│         │                    (verifies ed25519 signature)
│         │ ←──── JWT token ──────────────┘
│         │
│         │ Token stored in localStorage
│         │ Used on all /api/launches/* calls
└─────────┘
```

---

## 7. Data Flow: Tweet → Token Launch

```
1. Twitter/X
   ↓ (twitterapi.io webhook)
2. Backend POST /api/webhooks/twitterapi
   ↓ (parse + classify + upsert)
3. Supabase tweets table
   ↓ (frontend fetches via GET /api/feed)
4. React FeedPage
   ↓ (user clicks "Tokenize")
5. /tokenize page (pre-filled narrative)
   ↓ (user fills form + clicks Launch)
6. Backend POST /api/launches
   ↓ (create-token-info on Bags)
7. Bags API → returns tokenMint
   ↓ (fee-share config + launch tx + sign + submit)
8. Solana blockchain
   ↓ (tx confirmed)
9. Supabase launches table (status=launched)
   ↓ (Bags refresher picks up mint)
10. narrative_tokens updated with mcap/price/volume
    ↓ (feed auto-refreshes)
11. Frontend shows live market data + Buy button (→ Jupiter)
```

---

## 8. Environment Variables

See `.env.example` for full reference. Key vars:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side Supabase key |
| `BAGS_API_KEY` | Yes | Bags API authentication |
| `TWITTERAPI_IO_KEY` | Yes | For metrics refresher |
| `TWITTERAPI_WEBHOOK_KEY` | Yes | Webhook signature validation |
| `METRICS_REFRESH_INTERVAL_MS` | No | Default: 300,000 (5 min) |
| `METRICS_REFRESH_LIMIT` | No | Default: 20 |
| `TWEET_RETENTION_DAYS` | No | Default: 30 |
| `BAGS_REFRESH_INTERVAL_MS` | No | Default: 600,000 (10 min) |
| `PORT` | No | Default: 3001 (Railway overrides this) |

Frontend-only (build-time):
| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | Backend URL in production (e.g. `https://bagsapp-production.up.railway.app`) |

---

## 9. Deployment

### Backend (Railway)
```
1. railway.app → New Project → Deploy from GitHub Repo
2. Select NECOKIZZ/BagsApp-
3. Railway auto-detects Dockerfile + railway.json
4. Variables tab → paste all env vars from .env
5. Settings → Networking → Generate Domain
6. Verify: GET https://<domain>/api/health → {"ok":true}
```

### Frontend (Vercel) — Not yet deployed
```
1. vercel.com → Add New Project → Import GitHub repo
2. Framework: Vite
3. Build: npm run build | Output: dist
4. Env var: VITE_API_BASE=https://<railway-domain>
5. Deploy
```

### Local Development
```bash
# Terminal 1 — Backend
npm run dev:server          # Express on :3001, auto-reload

# Terminal 2 — Frontend
npm run dev                 # Vite on :5173, proxies /api to :3001

# Or both at once
npm run dev:all             # concurrently runs both
```

For frontend-only development with Railway backend:
```bash
# Create .env.local
VITE_API_BASE=https://bagsapp-production.up.railway.app
npm run dev                 # Frontend only, no local backend needed
```

---

## 10. Key Design Decisions

1. **Webhook over WebSocket**: twitterapi.io only supports webhooks. Simpler infra, no persistent connections.

2. **Backend handles all external APIs**: Frontend never calls twitterapi.io or Bags directly. Single auth point, CORS handled, secrets safe.

3. **Wallet auth, not username auth**: Crypto-native users expect wallet connect. No user table needed.

4. **Session-less JWT**: Nonce+signature generates a token stored in localStorage. Server validates signature on every protected request. No session store needed.

5. **Defensive parsing everywhere**: Bags API field names are undocumented. The code tries 10+ possible field names for mcap, price, volume.

6. **Monorepo with shared package.json**: Frontend and backend share deps. Simpler for solo dev, slightly larger Docker image (acceptible trade-off).

7. **Split hosting**: Railway for backend (always-on process), Vercel for frontend (static CDN). Cost-optimized.

---

## 11. Cost Estimates

### twitterapi.io (metrics refresher)
- Default: 20 tweets × every 5 min = 5,760 calls/day = ~86,400 credits/day
- **Annual cost: ~$259** (at ~$30/10k credits)
- **Tuning**: Reduce `METRICS_REFRESH_LIMIT` to 10, increase interval to 10 min → ~$65/year

### Railway (backend)
- Hobby tier: ~$5/month = **$60/year**
- Includes compute, bandwidth, PostgreSQL

### Vercel (frontend)
- Hobby tier: **Free** for static sites

### Total Estimated Operating Cost
- **Conservative**: ~$325/year
- **Optimized**: ~$125/year

---

## 12. Future Roadmap

### Short Term (In Progress)
- [ ] Wire tweet_id through tokenize flow → link launches to tweets
- [ ] Insert into `narrative_tokens` on successful launch
- [ ] Redirect to `/token/<mint>` instead of `/` on success
- [ ] Token detail page with real Bags pool data
- [ ] Image upload to IPFS/Arweave (currently requires public URL)

### Medium Term
- [ ] Live tweet streaming via WebSocket (fallback to polling)
- [ ] Token watchlist / favorites
- [ ] Push notifications for high-score narratives
- [ ] Creator scoring algorithm (engagement + follower growth)
- [ ] Multi-wallet support (Backpack, Solflare)

### Long Term
- [ ] On-chain creator revenue sharing
- [ ] Token analytics dashboard (holders, volume charts)
- [ ] Mobile app (React Native)
- [ ] AI narrative detection (classify tweets by token potential)

---

## 13. Troubleshooting

### Backend won't start
```bash
# Check .env is in project root (next to package.json)
ls .env
# Verify BAGS_API_KEY is loaded
curl http://localhost:3001/api/health/bags
```

### Webhook not receiving tweets
1. Check twitterapi.io dashboard → Filters → Webhook URL matches Railway domain
2. Verify `TWITTERAPI_WEBHOOK_KEY` matches both sides
3. Check Railway logs for webhook POSTs

### Bags launch fails with 500
1. Enable debug: `LOG_BAGS_HTTP=true` in .env, restart
2. Check wallet has enough SOL (≥0.21 + fees)
3. Verify token name ≤32 chars, ticker ≤10, no `$`
4. Image URL must be publicly reachable

### Feed shows stale data
- Metrics refresher only updates young tweets. Older tweets stay static (by design, to save credits).
- Bags refresher only updates tokens with mint addresses. Pre-launch tokens show `$0`.

---

## 14. File Index

### Frontend (`src/`)
```
src/
├── app/
│   ├── components/
│   │   ├── Layout.tsx              # App shell (nav + outlet)
│   │   ├── TweetCard.tsx           # Tweet display with tokens + buy button
│   │   ├── TweetCardSkeleton.tsx   # Shimmer loading placeholder
│   │   └── ui/                     # shadcn/ui primitives (auto-generated)
│   ├── pages/
│   │   ├── FeedPage.tsx            # Main feed with filters + wallet
│   │   ├── TokenizePage.tsx        # Token launch form + signing flow
│   │   ├── TokenDetailPage.tsx     # Token analytics (placeholder)
│   │   ├── ProfilePage.tsx         # User profile + holdings
│   │   ├── CreatorsPage.tsx        # Tracked accounts leaderboard
│   │   └── TokensHeldPage.tsx      # Portfolio view
│   └── routes.tsx                  # React Router config
├── lib/
│   ├── api.ts                      # API client (fetch wrappers + VITE_API_BASE)
│   ├── phantom.ts                  # Phantom wallet detection + helpers
│   └── bagsLaunch.ts              # End-to-end launch orchestration
└── main.tsx                        # App entry point
```

### Backend (`server/`)
```
server/
├── index.ts           # Express app: routes, jobs, server start
├── bagsClient.ts      # Bags API v2 client with error handling
├── supabaseClient.ts  # Supabase connection
└── loadEnv.ts         # .env loading with hot-reload
```

### Root Config
```
├── package.json        # Scripts + dependencies (shared frontend/backend)
├── Dockerfile          # Production image (Alpine + Node 20)
├── .dockerignore       # Excludes frontend source, .env, etc.
├── railway.json        # Railway deployment config
├── .nvmrc              # Pins Node 20
├── .env.example        # Environment variable template
├── .env.local          # Frontend-only: VITE_API_BASE (gitignored)
└── vite-env.d.ts       # TypeScript declarations for Vite env vars
```

---

*Questions? Check server logs or ping the dev team.*
