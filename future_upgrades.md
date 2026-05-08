# Future Upgrades

## User-Requested Features

### 1. In-App Analytics Dashboard
- **Volume Driven**: Track total trading volume your app has facilitated across all tokens (aggregate Jupiter swap volume for tokens in your feed).
- **Fees Earned**: If you collect fees on token launches or swaps, display a real-time running total of revenue.
- **Tokens Created In-App**: Already visible in the Market Terminal "MY APP" tab, but could be expanded into a full dashboard with launch dates, performance charts, and creator attribution.

### 2. Auto-Buy Agents
- **Feed Monitoring Agents**: Deploy agents that watch your feed 24/7 and automatically purchase tokens based on user-defined rules (e.g., score threshold, narrative match, creator reputation).
- **Strategy Builder**: Let users configure buy rules — min score, max mcap, specific creators, keyword triggers.
- **Risk Controls**: Max spend per trade, daily budget limits, stop-loss rules.
- **Execution**: Integrate with Phantom wallet sessions to sign transactions automatically (with explicit user permission).

## Suggested Additional Features

### 3. Token Creator Profiles
- **Creator Pages**: Dedicated pages for each Twitter account you track, showing their token launch history, average performance, follower growth, and reliability score.
- **Creator Streaks**: Badge system for creators who consistently launch high-performing tokens.

### 4. Alert & Notification System
- **Push Notifications**: Browser push alerts for high-score tokens, tokens from favorite creators, or tokens about to cross a price threshold.
- **Telegram/Discord Bot**: Mirror your feed into a community channel with real-time alerts.

### 5. Advanced Filtering & Search
- **Search Bar**: Search tokens by ticker, name, or creator handle.
- **Filter by Creator**: Show only tokens from specific Twitter accounts.
- **Filter by Performance**: Hide tokens below a certain market cap, volume, or score threshold.
- **Saved Filters**: Let users save and name their favorite filter combinations.

### 6. Token Watchlists
- **Personal Watchlists**: Users can bookmark tokens to a private watchlist for quick access, separate from the full feed.
- **Price Alerts on Watchlist**: Get notified when a watched token moves >X% or crosses a target price.

### 7. Community Features
- **Comment Threads**: Let users comment on individual tokens or tweets within the app (stored in your Supabase, not on-chain).
- **Upvote/Downvote**: Community sentiment scoring on tokens beyond your AI score.
- **Leaderboard**: Top token creators, top traders, most active community members.

### 8. Token Launch Improvements
- **One-Click Launch**: Streamline the tokenize flow to a single form with preview before submission.
- **Launch Templates**: Pre-set liquidity amounts, image generation, and metadata templates.
- **Post-Launch Actions**: Immediately after launch, offer "Share to X", "Add to Watchlist", or "Buy Initial Supply".

### 9. Performance & Monetization
- **Analytics for Creators**: Give token creators a dashboard showing their token's holders, top buyers, trading volume over time.
- **Revenue Share Display**: Transparently show what percentage of fees goes to the platform vs. creators.
- **Referral Program**: Users get a cut of fees from traders they refer to the platform.

### 10. Mobile-First Enhancements
- **PWA Install Prompt**: Make the app installable as a home-screen app with offline skeleton screens.
- **Pull-to-Refresh**: Native-feeling refresh gesture on the feed.
- **Bottom Navigation Bar**: Alternative to top nav for thumb reachability on large phones.

## Priority Ranking (Suggested)

1. **Analytics Dashboard** — High impact, builds trust with users
2. **Auto-Buy Agents** — Differentiator feature, drives engagement
3. **Alert System** — Retains users, brings them back to the app
4. **Watchlists** — Low effort, high user value
5. **Search & Advanced Filters** — Essential as token count grows
6. **Community / Comments** — Network effects, but moderation required
7. **Creator Profiles** — SEO value, attracts creators to your platform
8. **Mobile PWA** — Conversion booster for mobile users

## Technical Notes

- **Volume/Fees Tracking**: Requires indexing Jupiter swap transactions involving your tracked tokens. Could query Jupiter's API or Helius webhooks.
- **Auto-Buy Agents**: Requires a backend job queue + secure wallet session management. Consider using Circle's programmable wallets for server-side signing.
- **Alerts**: Use web push (Service Worker) or integrate with a push provider like OneSignal.
