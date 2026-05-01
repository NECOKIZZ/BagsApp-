# BagsApp — Full UI Specification

> **Purpose:** This document is the complete UI/UX spec for BagsApp. Feed it to your LLM to implement the full frontend. Every component, layout, interaction, state, and data binding is described here. Nothing is left ambiguous.

---

## 1. App-Level Structure

### Layout
The app is a single-page application (SPA) with a fixed topbar and a two-column body layout on the Feed page. All pages share the topbar.

```
┌─────────────────────────────────────────────────────┐
│                     TOPBAR                          │
├─────────────────────────────────────┬───────────────┤
│                                     │               │
│         MAIN CONTENT AREA           │   BUY PANEL   │
│     (Feed / Portfolio)              │  (Feed only)  │
│                                     │               │
└─────────────────────────────────────┴───────────────┘
```

- **Topbar:** fixed, full width, `height: 48px`
- **Main content area:** fills remaining width, scrollable vertically
- **Buy panel:** `width: 260px`, fixed right column, only visible on Feed page, not scrollable independently — it sticks to top

### Pages
There are exactly **2 pages**:
1. **Feed** (default, `/`) — live narrative stream + buy panel
2. **Portfolio** (`/portfolio`) — user holdings + launched tokens

The old Creators page has been removed. Creator context is surfaced inline on tweet cards instead.

---

## 2. Design Tokens

Use these consistently across all components. Map them to your CSS variables or Tailwind config.

### Colors
```
Background:
  --bg-primary:     white (card surfaces)
  --bg-secondary:   light gray (stat boxes, inputs, chip defaults)
  --bg-tertiary:    page background
  --bg-info:        very light blue
  --bg-success:     very light green
  --bg-warning:     very light amber
  --bg-danger:      very light red

Text:
  --text-primary:   near-black
  --text-secondary: medium gray
  --text-tertiary:  light gray / hints
  --text-success:   green
  --text-danger:    red
  --text-warning:   amber
  --text-info:      blue

Borders:
  --border-subtle:  0.15 alpha black (default dividers)
  --border-medium:  0.30 alpha black (hover, emphasis)

Brand accent: #1D9E75 (teal-green) — used for CTAs, selected states, confirmed states
```

### Typography
```
Font: system sans-serif stack (Inter, SF Pro, Segoe UI)
Weights: 400 (regular), 500 (medium) — no 600 or 700
Sizes:
  10px — labels, uppercase section headers
  11px — meta text, badges, timestamps, creator signals
  12px — narrative quotes, receipt rows, filter chips
  13px — tweet handles, token names in list, body text
  14px — buy panel token name, stat values
  15px — topbar logo, wallet button, portfolio primary values
```

### Spacing
```
Component internal padding: 8px, 12px, 16px
Card padding: 12px (feed cards), 16px (portfolio cards)
Gap between cards: 10px
Gap between sections: 14–16px
Border radius:
  pill:   99px (badges, chips, buttons, avatars)
  card:   12px
  inner:  8px (stat boxes, token rows, receipt blocks)
```

### Borders
```
Default card border:   0.5px solid --border-subtle
Selected card border:  1.5px solid #1D9E75
Buy panel left border: 0.5px solid --border-subtle
Section dividers:      0.5px solid --border-subtle
Dashed border (empty state): 0.5px dashed --border-medium
```

---

## 3. Topbar

**Always visible. Never scrolls.**

```
[ • bags ]    [ Feed ]  [ Portfolio ]    [ • live ]  [ 9xK3...f2Rp ]
```

### Elements

**Logo** (left)
- Small filled circle dot in brand green `#1D9E75`, 8px diameter
- Text: "bags" — 15px, weight 500
- No link, no action

**Nav pills** (center)
- Two pills: "Feed" and "Portfolio"
- Pill style: `border-radius: 99px`, `padding: 5px 12px`, `font-size: 12px`
- Default state: no background, no border, text in `--text-secondary`
- Active state: `background: --bg-secondary`, `border: 0.5px solid --border-medium`, text in `--text-primary`, weight 500
- Clicking a pill navigates to that page and hides/shows the buy panel accordingly

**Live indicator** (right, before wallet button)
- 6px filled circle, color `#1D9E75`, with a slow CSS pulse animation (opacity 1 → 0.4 → 1, 2s loop)
- Text: "live" — 12px, `--text-secondary`
- No interaction

**Wallet button** (far right)
- Shows truncated wallet address: first 4 chars + "..." + last 4 chars
- Style: `border-radius: 99px`, `padding: 5px 12px`, `font-size: 12px`, weight 500
- Background: `--bg-secondary`, border: `0.5px solid --border-medium`
- On click: no action needed in MVP (placeholder)

---

## 4. Feed Page

### Layout
```
┌─────────────────────────────────────┬───────────────┐
│  [hot strip]                        │               │
│  [filter bar]                       │   BUY PANEL   │
│  [tweet card]                       │               │
│  [tweet card]                       │               │
│  [tweet card]                       │               │
│  [tweet card]                       │               │
└─────────────────────────────────────┴───────────────┘
```

The feed column is scrollable. The buy panel is not — it stays fixed at the top-right.

---

### 4a. Hot Strip

Shown at the top of the feed, above the filter bar. Only shown when there is at least one high-score narrative active.

```
┌─────────────────────────────────────────────────────┐
│  Trending now   AI agents narrative — 3 tokens...   │  score 91  │
└─────────────────────────────────────────────────────┘
```

- Background: amber-50 (`#FAEEDA`), border: `0.5px solid #FAC775`, `border-radius: 8px`
- "Trending now" label: 11px, weight 500, color `#633806`
- Description text: 12px, color `#854F0B`, flex: 1 (fills space)
- Score badge: see Badge spec below, uses hot/amber style
- Padding: `8px 10px`

---

### 4b. Filter Bar

Horizontal row of pill-shaped filter chips. Scrollable horizontally on mobile.

**Filters (in order):**
1. All
2. High score
3. No token yet
4. Tweets only

**Chip style:**
- Default: `background: --bg-primary`, `border: 0.5px solid --border-subtle`, text `--text-secondary`, 11px
- Active: `background: #E1F5EE`, `border: 0.5px solid #5DCAA5`, text `#085041`, weight 500
- `border-radius: 99px`, `padding: 4px 10px`
- Only one chip active at a time

**Behavior:**
- Filtering is client-side. Each filter hides/shows tweet cards based on:
  - **All:** show everything
  - **High score:** show only cards where token score ≥ 80
  - **No token yet:** show only cards with no linked token
  - **Tweets only:** hide reposts and quotes (show only type=tweet)

---

### 4c. Tweet Card

The core feed unit. One card per tweet. Cards stack vertically with `gap: 10px`.

**Card container:**
- `background: --bg-primary`
- `border: 0.5px solid --border-subtle`
- `border-radius: 12px`
- `padding: 12px`
- Cursor: pointer
- Hover: `border-color: --border-medium`
- **Selected state:** `border: 1.5px solid #1D9E75` — applied when this card's token is loaded in the buy panel
- Clicking any card selects it and loads its token into the buy panel

#### Card Header Row

```
[ Avatar ]  @handle                    [ type badge ] [ hot badge? ]
            6 tokens launched · avg +89% return · 2h ago
```

**Avatar:**
- Circle, 32px diameter, `border-radius: 50%`
- Background: unique per account (pick from teal, blue, pink, purple, amber, coral — be consistent per handle)
- Content: 2-letter initials, 12px, weight 500, same ramp darker color as background
- No image loading — initials only in MVP

**Handle:**
- 13px, weight 500, `--text-primary`
- Format: `@handle`

**Creator signal line** (below handle):
- 11px, `--text-tertiary`
- Format: `{N} tokens launched · avg {+X% or -X%} return · {time ago}`
- "avg +X% return" — color `--text-success` when positive, `--text-danger` when negative, weight 500
- Separator between items: `·` in `--border-medium` color

**Type badge** (top right of header):
- Pill, 10px, weight 500, `border-radius: 99px`, `padding: 2px 7px`
- tweet → `background: #E6F1FB`, text `#0C447C`
- repost → `background: #F1EFE8`, text `#444441`
- quote → `background: #EEEDFE`, text `#3C3489`
- comment → `background: #FBEAF0`, text `#72243E`

**Hot badge** (optional, shown when score ≥ 85):
- Same pill style: `background: #FAEEDA`, text `#633806`
- Text: "hot"

**New token badge** (optional, shown when token launched < 1 hour ago):
- `background: #E1F5EE`, text `#085041`
- Text: "new token"

#### Narrative Quote Block

The tweet content, styled as a quote:

```
│ every major AI lab is building agents now. this is the
│ year it becomes real. we are so early
```

- `border-left: 2px solid #5DCAA5`
- `padding-left: 8px`
- `margin: 6px 0`
- `font-size: 12px`, `--text-secondary`, `line-height: 1.5`
- Truncate at 3 lines with `overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3`

#### Engagement Stats Row

Single line below the quote:

```
4.2k likes   1.1k RT   891k views
```

- 11px, `--text-tertiary`
- `gap: 12px`, `margin-bottom: 8px`
- Format large numbers: `4200 → 4.2k`, `891000 → 891k`

#### Token Row (when token exists)

Shown below engagement stats. Slightly inset — distinct background:

```
┌───────────────────────────────────────────────────────┐
│  [icon] $AIAGENT        [91]   +124%      [ Buy ]    │
│         match 87%             $42.1k mcap            │
└───────────────────────────────────────────────────────┘
```

- `background: --bg-secondary`, `border-radius: 8px`, `padding: 7px 8px`
- `display: flex`, `align-items: center`, `gap: 8px`

**Token icon:**
- 22px circle, initials, same color system as avatar
- First 2 chars of ticker (without $)

**Token name + match:**
- Name: 12px, weight 500, `--text-primary` — e.g. `$AIAGENT`
- Match: 10px, `--text-tertiary` — e.g. `match 87%`

**Token score pill:**
- 11px, weight 500, `border-radius: 99px`, `padding: 2px 7px`
- Score ≥ 80: `background: #E1F5EE`, text `#085041` (green)
- Score 60–79: `background: #FAEEDA`, text `#633806` (amber)
- Score < 60: `background: #F1EFE8`, text `#444441` (gray)

**Return + mcap (right of score):**
- Return: 12px, weight 500 — green if positive, red if negative
- Mcap: 10px, `--text-tertiary` — format as `$42.1k` or `$1.2M`

**Buy button (far right):**
- `border-radius: 99px`, `padding: 4px 10px`, `font-size: 11px`, weight 500
- `background: #1D9E75`, `color: #E1F5EE`, no border
- On click: selects this card (loads token into buy panel). Does NOT navigate away.
- `event.stopPropagation()` so it doesn't double-trigger the card click

#### No Token State (when no token linked yet)

Replaces the token row:

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  No token yet — be first          [ Tokenize ↗ ]
  narrative score 88 · high potential
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

- `background: --bg-secondary`
- `border: 0.5px dashed --border-medium`
- `border-radius: 8px`, `padding: 8px 10px`
- Left text: "No token yet — be first" (12px, `--text-secondary`) + score line (10px, `--text-tertiary`)
- Tokenize button: same green pill as Buy button — navigates to `/tokenize` route with narrative pre-filled

---

## 5. Buy Panel

Fixed right column, `width: 260px`. Only visible on Feed page. Disappears on Portfolio page.

The panel always reflects the currently selected tweet card. On initial load, the first card in the feed is selected by default.

### Panel Structure (top to bottom)

```
section label: "Buy token"
─────────────────────────
Token header (icon + name + age + buyer badge)
─────────────────────────
Stat grid (2×2)
─────────────────────────
Amount selector (presets)
─────────────────────────
Receipt block
─────────────────────────
Buy button (CTA)
─────────────────────────
Step indicator
─────────────────────────
Slippage selector
```

**Panel container:**
- `background: --bg-primary`
- `border-left: 0.5px solid --border-subtle`
- `padding: 12px`
- `display: flex`, `flex-direction: column`, `gap: 10px`

---

### 5a. Section Label

```
BUY TOKEN
```

- 10px, weight 500, `--text-tertiary`
- ALL CAPS, `letter-spacing: 0.05em`

---

### 5b. Token Header

```
[ icon ]  $AIAGENT           [ buyer #47 ]
          launched 14 min ago
```

- `display: flex`, `align-items: center`, `gap: 8px`

**Token icon:** 36px circle — same color system as feed card token icons

**Name:** 14px, weight 500, `--text-primary`

**Age/subtitle:** 11px, `--text-tertiary` — e.g. "launched 14 min ago"

**Buyer rank badge** (right, `margin-left: auto`):
- `background: #FAEEDA`, `color: #633806`, `border: 0.5px solid #EF9F27`
- `border-radius: 99px`, `padding: 2px 8px`, 10px, weight 500
- Text: "buyer #N" — shows how many buyers have already bought
- This is the first-mover urgency signal. Always show it.
- When no token exists: show "be #1"

---

### 5c. Stat Grid

2-column, 2-row grid of stat boxes:

```
┌──────────┬──────────┐
│  mcap    │  24h vol │
│  $42.1k  │  $18.3k  │
├──────────┼──────────┤
│  return  │ token    │
│  +124%   │ score 91 │
└──────────┴──────────┘
```

**Stat box:**
- `background: --bg-secondary`, `border-radius: 8px`, `padding: 8px 10px`
- Label: 10px, `--text-tertiary`, margin-bottom 2px
- Value: 14px, weight 500, `--text-primary`
- Return value: green if positive, red if negative
- Score value: neutral `--text-primary` (score belongs to token, not to the return)

**When no token linked yet:** show `—` for mcap, vol, return. Show narrative score in the score box.

---

### 5d. Amount Selector

```
amount (sol)
[ 0.1 ]  [ 0.5 ]  [ 1 ]  [ 2 ]
```

**Label:** "amount (SOL)" — 10px section label style

**Preset buttons row:**
- 4 equal-width buttons in a row, `gap: 5px`
- Default: `background: --bg-secondary`, `border: 0.5px solid --border-subtle`, `--text-secondary`
- Active: `background: #E1F5EE`, `border: 0.5px solid #1D9E75`, `color: #085041`, weight 500
- `border-radius: 8px`, `padding: 6px 0`, 12px text, centered
- Only one active at a time
- Default active: 0.1

**On preset click:**
- Set active state
- Recalculate receipt block (tokens out, price impact, wallet after)

---

### 5e. Receipt Block

Shows the computed details for the current amount selection:

```
┌────────────────────────────────────┐
│ you get ~      2,840 tokens        │
│ price impact   0.4%                │
│ fee            0.5%                │
│ wallet after   4.72 SOL            │
└────────────────────────────────────┘
```

- `background: --bg-secondary`, `border-radius: 8px`, `padding: 8px 10px`
- Each row: `display: flex`, `justify-content: space-between`, 12px
- Left column: `--text-secondary`
- Right column: `--text-primary`, weight 500 for "you get ~"

**Calculations:**
- `tokens out = sol_amount × token_rate` (token_rate comes from token data — approximate tokens per SOL)
- `price impact`: 0.4% for 0.1 SOL, 1.2% for 0.5 SOL, 2.8% for 1 SOL, 5.1% for 2 SOL (simplified tiers)
- `price impact color`: green < 1%, amber 1–3%, red > 3%
- `fee`: always 0.5% (fixed)
- `wallet after`: current wallet balance − sol_amount, formatted to 2 decimal places
- `wallet after color`: red if result < 0.1 SOL (warn user they're going dangerously low)

---

### 5f. Buy Button (CTA)

```
[ Buy now via Jupiter ]
```

- Full width, `padding: 12px`, 14px, weight 500
- `border-radius: 8px`, no border
- Ready state: `background: #1D9E75`, `color: #E1F5EE`
- Disabled state: `opacity: 0.5`, `cursor: default`
- Hover: `opacity: 0.9`
- Active/press: `transform: scale(0.98)`

**On click → triggers the 3-step signing flow (see Section 5g)**

**Post-success state:**
- Button text changes to: "View in portfolio ↗"
- Background changes to blue (`#185FA5`)
- On click: navigates to Portfolio page

---

### 5g. Step Indicator

Three dots connected by lines, showing signing progress:

```
● — ○ — ○   wallet connected
```

**Dot states:**
- Default (upcoming): `background: --border-medium`, 7px circle
- Active (in progress): `background: --text-info` (blue), 7px circle
- Done (complete): `background: #1D9E75`, 7px circle

**Connecting lines:** `height: 1px`, `width: 14px`, `background: --border-subtle`

**Label text** (right of dots): 10px, `--text-tertiary` — updates per step:
- Step 0 done: "wallet connected"
- Step 1 active: "approve in wallet"
- Step 2 active: "submitting tx..."
- All done: "confirmed!"

**3-step signing flow timing:**
1. Click buy → step 1 goes active, label = "approve in wallet", button text = "Approving in Phantom..."
2. After ~1300ms → step 1 done, step 2 active, label = "submitting tx...", button text = "Submitting..."
3. After ~2700ms total → step 2 done, label = "confirmed!", button flips to "View in portfolio ↗"

In production: steps 1 and 2 are driven by actual Phantom wallet events, not timers.

---

### 5h. Slippage Selector

```
slippage
[ 1% ]  [ 3% ]  [ 5% ]
```

- Label: "slippage" — 11px, `--text-tertiary`
- Three buttons, same style as amount presets but smaller: `padding: 4px 0`, 11px text
- Default active: 1%
- Only one active at a time
- No live effect in MVP (value is passed to Jupiter swap params on submit)

---

## 6. Portfolio Page

Replaces the feed column + buy panel. Full-width, scrollable.

### Layout

```
[ stat grid (2×2) ]
─────────────────────────
your holdings
[ token holding card ]
[ token holding card ]
[ token holding card ]
─────────────────────────
tokens you launched
[ launched token card ]
```

---

### 6a. Portfolio Stat Grid

Same 2×2 grid component as buy panel stat grid:

```
┌────────────────┬────────────────┐
│  total value   │  unrealised P&L│
│  $1,284        │  +$312         │
├────────────────┼────────────────┤
│  tokens held   │  tokens launched│
│  4             │  1             │
└────────────────┴────────────────┘
```

- Unrealised P&L: green if positive, red if negative
- `margin-bottom: 4px`

---

### 6b. Section Labels

```
YOUR HOLDINGS
```

- 10px, weight 500, `--text-tertiary`, ALL CAPS, `letter-spacing: 0.05em`
- `margin-top: 8px`, `margin-bottom: 4px`

Two sections:
1. "Your holdings" — tokens bought via the app
2. "Tokens you launched" — tokens created by this wallet

---

### 6c. Token Holding Card

```
┌─────────────────────────────────────────────────────┐
│  [icon]  $AIAGENT                   +124%           │
│          2,840 tokens · score 91    $234             │
└─────────────────────────────────────────────────────┘
```

- `background: --bg-primary`
- `border: 0.5px solid --border-subtle`
- `border-radius: 12px`
- `padding: 12px`
- `display: flex`, `align-items: center`, `gap: 10px`

**Token icon:** 32px circle, same color system

**Left text block:**
- Name: 13px, weight 500, `--text-primary`
- Subline: 11px, `--text-tertiary` — format: `{N} tokens · score {S}`

**Right text block** (`margin-left: auto`, `text-align: right`):
- Return %: 13px, weight 500 — green if positive, red if negative
- USD value: 11px, `--text-secondary`

---

### 6d. Launched Token Card

Same as holding card but with **green accent border** to distinguish it:

```
┌─────────────────────────────────────────────────────┐ ← 1.5px #1D9E75 border
│  [icon]  $DEFIMETA                  +67%            │
│          launched by you · 134 holders   $28.4k mcap│
└─────────────────────────────────────────────────────┘
```

- `border: 1.5px solid #1D9E75` (green accent, not the default 0.5px)
- Subline: `launched by you · {N} holders`
- Right block: return % + mcap value (not USD holdings value)

---

## 7. Data Shapes (Frontend Contracts)

These are the data objects the frontend expects from the API.

### Creator (from `GET /api/feed`)
```ts
type Creator = {
  handle: string;           // "@karpathy"
  initials: string;         // "AK"
  avatarColor: string;      // hex bg color for avatar
  tokensLaunched: number;   // total tokens this creator has spawned
  avgReturn: number;        // average % return across all their tokens (can be negative)
}
```

### Tweet (from `GET /api/feed`)
```ts
type Tweet = {
  id: string;
  tweetId: string;
  creator: Creator;
  content: string;
  type: 'tweet' | 'repost' | 'quote' | 'comment';
  likes: number;
  retweets: number;
  views: number;
  postedAt: string;         // ISO timestamp
  token?: NarrativeToken;   // null if no token launched yet
}
```

### NarrativeToken
```ts
type NarrativeToken = {
  name: string;             // "AIAGENT"
  ticker: string;           // "$AIAGENT"
  mintAddress: string | null;
  matchScore: number;       // 0–100, narrative-to-token relevance
  score: number;            // 0–100, overall token score
  currentMcap: number;      // USD
  currentPrice: number;     // USD
  totalVolume: number;      // 24h USD
  returnPct: number;        // e.g. 124.5 or -12.0
  launchedAt: string;       // ISO timestamp
  launchedHere: boolean;
  buyerCount: number;       // for "buyer #N" badge
  tokenRate: number;        // approximate tokens per 1 SOL (for receipt calc)
}
```

### Portfolio (from `GET /api/portfolio/:wallet`)
```ts
type PortfolioToken = {
  ticker: string;
  name: string;
  tokenCount: number;       // how many tokens held
  score: number;
  returnPct: number;
  usdValue: number;
  launchedByUser: boolean;
  holderCount?: number;     // only if launchedByUser
  mcap?: number;            // only if launchedByUser
}

type Portfolio = {
  totalUsdValue: number;
  unrealisedPnl: number;
  tokensHeld: number;
  tokensLaunched: number;
  holdings: PortfolioToken[];
}
```

---

## 8. Number Formatting Rules

Apply consistently everywhere in the UI:

| Value | Format |
|---|---|
| 4200 likes | `4.2k` |
| 891000 views | `891k` |
| 1200000 views | `1.2M` |
| $42100 mcap | `$42.1k` |
| $1200000 mcap | `$1.2M` |
| +124.5% return | `+124%` |
| -12.3% return | `-12%` |
| 2840 tokens | `2,840` (locale string) |
| 4.7234 SOL | `4.72 SOL` (2dp) |
| score 91 | `91` (integer, no decimals) |

---

## 9. Color Assignment for Avatars & Token Icons

Use this deterministic color map based on first letter of handle/ticker so colors are consistent across page loads:

```
A, B → teal    (#E1F5EE bg / #085041 text)
C, D → blue    (#E6F1FB bg / #0C447C text)
E, F → purple  (#EEEDFE bg / #3C3489 text)
G, H → coral   (#FAECE7 bg / #712B13 text)
I, J → pink    (#FBEAF0 bg / #72243E text)
K, L → amber   (#FAEEDA bg / #633806 text)
M, N → purple  (#EEEDFE bg / #3C3489 text)
O, P → teal    (#E1F5EE bg / #085041 text)
Q, R → blue    (#E6F1FB bg / #0C447C text)
S, T → pink    (#FBEAF0 bg / #72243E text)
U, V → purple  (#EEEDFE bg / #3C3489 text)
W, X → coral   (#FAECE7 bg / #712B13 text)
Y, Z → amber   (#FAEEDA bg / #633806 text)
```

---

## 10. Auto-Refresh Behavior

- Feed polls `GET /api/feed` every **30 seconds**
- Polling pauses when the browser tab is hidden (`document.visibilityState === 'hidden'`)
- On new data: silently update the feed in-place — no scroll jump, no loading flash
- If the selected card is still present after refresh, keep it selected and keep buy panel state
- If the selected card has disappeared (tweet deleted/cleaned up), select the first card

---

## 11. Empty States

**Feed is empty (no tweets):**
```
No narratives yet.
Tweets from tracked accounts will appear here in real-time.
```
Centered text, 14px, `--text-secondary`

**Portfolio is empty (no holdings):**
```
No tokens yet.
Buy or launch a token from the feed to see it here.
```
With a button: "Go to feed →" — navigates to Feed page

**No token yet on tweet card:**
The dashed "No token yet — be first" CTA row (see Section 4c)

---

## 12. Responsive Behavior

BagsApp is primarily a desktop/tablet web app. On mobile:

- Buy panel collapses — hidden from the feed view
- Clicking "Buy" on a token row opens a bottom sheet / modal with the buy panel contents
- Portfolio page remains single-column, same design
- Filter bar scrolls horizontally without wrapping
- Topbar nav pills reduce padding: `padding: 4px 8px`

Breakpoint: `768px` — below this, hide the buy panel column and enable bottom sheet buy flow.

---

## 13. Key Interaction Summary

| Trigger | Action |
|---|---|
| Click tweet card | Select card, load token into buy panel |
| Click Buy button on token row | Same as above (stopPropagation) |
| Click amount preset | Update active state, recalculate receipt |
| Click slippage preset | Update active state |
| Click "Buy now via Jupiter" | Start 3-step signing flow |
| Signing flow completes | Button → "View in portfolio ↗", navigates on click |
| Click "Tokenize ↗" on no-token card | Navigate to /tokenize with narrative pre-filled |
| Click "Feed" nav pill | Show feed + buy panel |
| Click "Portfolio" nav pill | Show portfolio, hide buy panel |
| Tab hidden | Pause feed auto-refresh |
| Tab visible | Resume feed auto-refresh |

---

## 14. What Was Deliberately Excluded

These pages/features were considered and removed:

- **Creators page** — scores on monitored accounts are meaningless to degens. Creator track record is surfaced inline on tweet cards instead (tokens launched + avg return).
- **Tokens Held page** — merged into Portfolio page as a section.
- **/token/:id detail page** — deferred. The buy panel in the feed surfaces enough data for the buy decision. Full analytics page is a v2 feature.
- **Username/password auth** — wallet connect only. No user table.
- **Image upload in tokenize flow** — requires public URL in MVP. IPFS/Arweave upload is v2.

---

*End of spec. Feed this document to your LLM along with the tech stack details from PROJECT_DOCS.md to implement the full UI.*
