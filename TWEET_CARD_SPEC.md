# Tweet Card — Structure Specification

> This document defines the **exact DOM structure, styling rules, and data requirements** for every tweet card variant in the Bags app. Build strictly to this spec.

---

## 1. Data Contract

Every card receives a single `tweet` object. All fields below are required unless marked optional.

```ts
type Tweet = {
  id: string                  // tweet_id from X — used to build "View on X" links
  type: "standalone" | "repost" | "quote" | "comment"
  text: string                // raw tweet body
  noun_spans: NounSpan[]      // [{start: number, end: number}] — from DB column
  created_at: string          // ISO timestamp

  creator: {
    display_name: string
    handle: string            // without @, e.g. "johndoe"
    avatar_url: string | null // admin-set; fall back to initials if null
  }

  // Only present on repost / quote / comment — never render the referenced tweet,
  // just use these fields for attribution labels and links
  referenced?: {
    handle: string            // the original author's handle
    tweet_id: string          // used to build the "View original ↗" link
  }
}

type NounSpan = {
  start: number   // char index, inclusive
  end: number     // char index, exclusive
}
```

---

## 2. Shared Card Shell

**Every card type uses the same outer shell.** Only the accent and inner sections differ.

```
┌─────────────────────────────────────────────┐
│ [left-accent-bar]  [card-body]              │
└─────────────────────────────────────────────┘
```

### HTML structure

```html
<article class="tweet-card tweet-card--{type}">
  <!-- Attribution line (repost / quote / comment only) -->
  <div class="tweet-card__attribution">…</div>

  <!-- Card body -->
  <div class="tweet-card__body">

    <!-- Row 1: avatar + author -->
    <div class="tweet-card__header">
      <a href="https://x.com/{handle}" target="_blank" rel="noopener">
        <img class="tweet-card__avatar" src="{avatar_url}" alt="{display_name}" />
        <!-- or initials fallback — see §4 -->
      </a>
      <div class="tweet-card__author">
        <a class="tweet-card__display-name"
           href="https://x.com/{handle}" target="_blank" rel="noopener">
          {display_name}
        </a>
        <a class="tweet-card__handle"
           href="https://x.com/{handle}" target="_blank" rel="noopener">
          @{handle}
        </a>
      </div>
      <time class="tweet-card__timestamp" datetime="{created_at}">
        {formatted_time}
      </time>
    </div>

    <!-- Row 2: tweet body -->
    <div class="tweet-card__content">
      {rendered_content}  <!-- see §5 and §6 -->
    </div>

    <!-- Row 3: footer -->
    <div class="tweet-card__footer">
      <a class="tweet-card__view-link"
         href="https://x.com/i/web/status/{tweet.id}"
         target="_blank" rel="noopener">
        View on X ↗
      </a>
    </div>

  </div>
</article>
```

---

## 3. Card Variants

All visual differentiation is driven by `tweet.type`. There are **no badge labels**. The shape and left accent communicate the type.

### 3a. Standalone

- No left accent bar
- No attribution line
- Plain white background

```css
.tweet-card--standalone {
  border-left: none;
  background: #ffffff;
}
```

### 3b. Repost

- **Green** left accent bar (4px)
- Attribution line above the header: `↻ Reposted from @{referenced.handle}`
  - `@{referenced.handle}` links to `https://x.com/{referenced.handle}`
- No ghost block

```css
.tweet-card--repost {
  border-left: 4px solid #16a34a;
}
.tweet-card__attribution {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 8px;
}
```

```html
<!-- Attribution line for repost -->
<div class="tweet-card__attribution">
  ↻ Reposted from
  <a href="https://x.com/{referenced.handle}" target="_blank" rel="noopener">
    @{referenced.handle}
  </a>
</div>
```

### 3c. Quote

- **Amber** left accent bar (4px)
- Attribution line above the header: `❝ Quoting @{referenced.handle}`
  - `@{referenced.handle}` links to `https://x.com/{referenced.handle}`
- Ghost block at the bottom of `tweet-card__content` (see §3e)

```css
.tweet-card--quote {
  border-left: 4px solid #d97706;
}
```

```html
<!-- Attribution line for quote -->
<div class="tweet-card__attribution">
  ❝ Quoting
  <a href="https://x.com/{referenced.handle}" target="_blank" rel="noopener">
    @{referenced.handle}
  </a>
</div>
```

### 3d. Comment / Reply

- **Purple** left accent bar (4px)
- Attribution line above the header: `↩ Replying to @{referenced.handle}`
  - `@{referenced.handle}` links to `https://x.com/{referenced.handle}`
- Ghost block at the bottom of `tweet-card__content` (see §3e)

```css
.tweet-card--comment {
  border-left: 4px solid #7c3aed;
}
```

```html
<!-- Attribution line for comment -->
<div class="tweet-card__attribution">
  ↩ Replying to
  <a href="https://x.com/{referenced.handle}" target="_blank" rel="noopener">
    @{referenced.handle}
  </a>
</div>
```

### 3e. Ghost Block (Quote + Comment only)

Render this at the **bottom** of `tweet-card__content`, after the tweet text. It signals missing referenced content without needing to fetch it.

```html
<div class="tweet-card__ghost-block">
  <span>Original tweet not loaded —</span>
  <a href="https://x.com/i/web/status/{referenced.tweet_id}"
     target="_blank" rel="noopener">
    View on X ↗
  </a>
</div>
```

```css
.tweet-card__ghost-block {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1.5px dashed #d1d5db;
  border-radius: 8px;
  font-size: 0.8rem;
  color: #9ca3af;
  background: #f9fafb;
}
.tweet-card__ghost-block a {
  color: #6b7280;
  text-decoration: underline;
  margin-left: 4px;
}
```

---

## 4. Avatar

### Happy path — admin has set `avatar_url`

```html
<img
  class="tweet-card__avatar"
  src="{creator.avatar_url}"
  alt="{creator.display_name}"
/>
```

### Fallback — `avatar_url` is null

Render an initials circle using the first letter of `display_name`.

```html
<div class="tweet-card__avatar tweet-card__avatar--initials"
     aria-label="{creator.display_name}">
  {display_name[0].toUpperCase()}
</div>
```

```css
.tweet-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.tweet-card__avatar--initials {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e5e7eb;
  color: #374151;
  font-weight: 600;
  font-size: 1rem;
}
```

---

## 5. @mention Rendering

Process `tweet.text` through `renderContent()` **before** noun highlighting (§6). Run them in this order:

1. `renderContent()` — splits text on `(@\w+)`, wraps matches in mention anchors
2. `renderNouns()` — applies green highlight spans from `noun_spans`

### renderContent() — pseudocode

```ts
function renderContent(text: string): Node[] {
  return text.split(/(@\w+)/g).map(part => {
    if (/^@\w+$/.test(part)) {
      const handle = part.slice(1)  // strip the @
      return <a
        href={`https://x.com/${handle}`}
        target="_blank"
        rel="noopener"
        class="tweet-mention"
      >{part}</a>
    }
    return <span>{part}</span>
  })
}
```

### Mention styles

```css
.tweet-mention {
  font-weight: 500;
  color: #185FA5;
  text-decoration: none;
}
.tweet-mention:hover {
  text-decoration: underline;
}
```

---

## 6. Noun Highlighting

`tweet.noun_spans` is a precomputed array from the database (set by a Haiku call at ingestion time). Do **not** run any NLP client-side.

Split the raw `text` into three span types using the offsets:

- Characters **inside** a noun span → `<mark class="tweet-noun">`
- Characters **outside** → plain text nodes

### Rendering logic — pseudocode

```ts
function renderNouns(text: string, spans: NounSpan[]): Node[] {
  const nodes = []
  let cursor = 0
  for (const { start, end } of spans) {
    if (cursor < start) nodes.push(<span>{text.slice(cursor, start)}</span>)
    nodes.push(<mark class="tweet-noun">{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) nodes.push(<span>{text.slice(cursor)}</span>)
  return nodes
}
```

> **Important:** Apply `renderNouns` on the **plain text segments** output by `renderContent()`, not on mention anchors. Never highlight inside an `<a>` tag.

### Noun highlight styles

```css
.tweet-noun {
  background-color: #bbf7d0;  /* green-200 */
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}
```

---

## 7. CSS Variables (Design Tokens)

Use these tokens throughout. Do not hardcode colours.

```css
:root {
  --card-bg: #ffffff;
  --card-radius: 12px;
  --card-padding: 16px;
  --card-shadow: 0 1px 3px rgba(0,0,0,0.08);

  --accent-standalone: transparent;
  --accent-repost: #16a34a;
  --accent-quote: #d97706;
  --accent-comment: #7c3aed;

  --mention-color: #185FA5;
  --noun-highlight: #bbf7d0;

  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-handle: #9ca3af;

  --avatar-size: 40px;
}
```

---

## 8. Full CSS Baseline

```css
.tweet-card {
  display: flex;
  flex-direction: row;
  background: var(--card-bg);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: var(--card-padding);
  gap: 0;
  position: relative;
  overflow: hidden;
}

/* Left accent bar is the border-left on the article itself */
.tweet-card--standalone { border-left: none; }
.tweet-card--repost     { border-left: 4px solid var(--accent-repost); }
.tweet-card--quote      { border-left: 4px solid var(--accent-quote); }
.tweet-card--comment    { border-left: 4px solid var(--accent-comment); }

.tweet-card__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding-left: 12px;
}

.tweet-card__attribution {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.tweet-card__attribution a {
  color: var(--mention-color);
  text-decoration: none;
}

.tweet-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.tweet-card__author {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.tweet-card__display-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-primary);
  text-decoration: none;
}
.tweet-card__display-name:hover { text-decoration: underline; }

.tweet-card__handle {
  font-size: 0.8rem;
  color: var(--text-handle);
  text-decoration: none;
}
.tweet-card__handle:hover { text-decoration: underline; }

.tweet-card__timestamp {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.tweet-card__content {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
}

.tweet-card__footer {
  margin-top: 12px;
}
.tweet-card__view-link {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-decoration: none;
}
.tweet-card__view-link:hover {
  text-decoration: underline;
  color: var(--mention-color);
}
```

---

## 9. What the Builder Must NOT Do

- Do not render or fetch the referenced tweet's content — only use `referenced.handle` and `referenced.tweet_id` for labels and links.
- Do not add badge/pill labels like "QUOTE" or "REPOST" — the left accent and attribution line are the full signal.
- Do not run any NLP or noun detection client-side — read `noun_spans` from the DB only.
- Do not allow users to override `avatar_url` — this is admin-only via Supabase.
- Do not apply noun highlights inside `<a>` tags (mention links).
- Do not add `tweet-card__attribution` or `tweet-card__ghost-block` to standalone cards.
