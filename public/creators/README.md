# Creator Avatar Images

Place creator profile images here to show real avatars in tweet cards.

## Naming Convention

**Use the creator's Twitter handle (lowercase, without `@`) as the filename.**

Examples:
| Creator | Handle | Filename |
|---------|--------|----------|
| Murad | @murad_m | `murad_m.png` |
| ansem | @blknoiz06 | `blknoiz06.png` |
| kaito | @kaitoai | `kaitoai.png` |
| cobie | @cobie | `cobie.png` |

## Supported Formats

- `.png` (preferred — has transparency support)
- `.jpg` / `.jpeg`
- `.webp`

## Resolution

Recommended: **128×128px** or larger. The UI crops to a 40×40px circle, so anything above 80×80px looks sharp on retina displays.

## Fallback Behavior

If an image is missing or fails to load, the tweet card falls back to the colored initials circle (same as before).

## How It Works

1. **Live tweets**: The backend pulls `avatar_url` from the `creators` table in Supabase. If that's empty, it falls back to `/creators/{handle}.png`.
2. **Static/demo tweets**: Each entry in `server/feedData.ts` has an `avatarUrl` pointing here.
3. **Frontend**: `TweetCard.tsx` renders an `<img>` when `avatarUrl` exists; otherwise shows the colored initials.
