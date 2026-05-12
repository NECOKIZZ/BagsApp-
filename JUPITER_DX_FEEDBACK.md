# Jupiter Developer Experience Report

I used Jupiter's quote, swap, price (v2 and v3), and tokens APIs in production. This is what actually happened.

## 1. Onboarding

First successful quote API call took maybe 30 minutes. Maybe 10 of those were actually integrating. The other 20 were spent figuring out which base URL to point at.

The `api.jup.ag` versus `lite-api.jup.ag` thing isn't documented anywhere I landed first. I had to read example code from somebody's gist to realize that without an API key, you should be hitting `lite-api.jup.ag`, and with a key, the pro host. Why is this not the loudest box on the landing page? 

This is what I used in my code:

```ts
const JUPITER_HOST = JUPITER_API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";
```
If not for claude opus, I probably would have spent another hour trying to figure it all out.

That decision should not be on me. Either auto route based on the presence of an `x-api-key` header, or document it like it matters. The free vs paid split is fine, the ambiguity around which URL works without a key is not.

The other onboarding friction was figuring out auth. There is no signup flow. There is no console. Where do I get a key, do I even need one for production memecoin volume, what are the limits on each tier. I had to guess all of this. I still do not know my actual rate limit because the response headers don't tell me.

Things that confused me:
- Two price endpoints live at the same time (v2 and v3) with different response shapes. Which one is canonical. Will v2 die. Should I migrate. Nothing tells me.
- Quote v1, swap v1. Where is the v2 of these. Are they stable. Why is everything labeled v1.
- The `quoteResponse` blob you have to round trip into `/swap` is opaque. If I tweak even one field by accident the whole thing breaks with a vague error.

## 2. What is broken or missing in the docs

Specific things I went looking for and could not find or had to dig hard for:

**SOL reservation when swapping SOL into a token.** The docs do not warn you that swapping near your full SOL balance will fail mid route with , because the route needs to wrap SOL, pay rent for new ATAs, and cover the priority fee. My swap landed onchain because I had `skipPreflight: true`, which is also what every  repo I saw set, failed inside the Jupiter route program, and the user paid the network fee for nothing. There needs to be a giant box somewhere that says: when paying with SOL, reserve at least 0.005 SOL for fees and rent, or the route will fail. I had to find this out by reading a failed transaction's program logs on Solscan.

**`prioritizationFeeLamports` configuration.** The schema is nested and confusing:

```json
{
  "prioritizationFeeLamports": {
    "priorityLevelWithMaxLamports": {
      "maxLamports": 1000000,
      "priorityLevel": "veryHigh"
    }
  }
}
```

What does `veryHigh` actually pay. Is it a percentile of recent fees. Is `maxLamports` a cap or a target. Are there other levels (`auto`, `medium`, `low`). What happens when network is congested and `veryHigh` still isn't enough. I had to guess.

**`dynamicSlippage`.** I turn it on. What does it do. What are the bounds. If I also pass `slippageBps` in the quote, who wins. Silence in the docs.

**Price API inconsistencies.** v2 returns `{ data: { [mint]: { price } } }`. v3 returns `{ [mint]: { usdPrice } }`. The field name is different (`price` vs `usdPrice`), the wrapping is different, and there is no migration note. I ended up coding both readers and falling back v2 then v3 because either one randomly returns nothing for fresh memecoins:

```ts
const v2Resp = await fetch(`${host}/price/v2?ids=${ids}`, { headers });
// ... if results missing, fall back to v3
const v3Resp = await fetch(`${host}/price/v3?ids=${ids}`, { headers });
```

That is silly. Pick one shape, deprecate the other on a clear timeline.

**`tokens.jup.ag/token/{mint}`.** Returns 200 with empty body for unknown tokens. Should be 404. Cost me a debugging session because my code thought "200 means valid metadata".

**Rate limits.** Not in headers. Not in the docs that I found. Are there per IP limits on the lite host. Per key on the pro host. Per route. I do not know.

## 3. Where the APIs bit me

The big one was the SOL balance failure I just described. The transaction landed onchain, ate gas, the user thought their swap went through, and I had to query the tx logs to even understand the failure. The fix was on my side (preflight enabled, reserve a buffer, validate balance before signing), but Jupiter's API responded fine, returned a transaction, and let me submit a doomed thing. A "simulateBeforeReturn" flag on `/swap` that reruns the route in a simulation and refuses to return a transaction that will fail would have saved me hours and saved my user real money.

Other bites:

**Quote 200 with weird routes for thin liquidity tokens.** I get back a quote for a fresh memecoin, the route plan is technically valid, but slippage is going to be 30% in practice. The `priceImpactPct` field exists but I have seen it return 0 on routes that absolutely had price impact. I had to add my own DexScreener cross check.

**`restrictIntermediateTokens=true` is on by default in some examples and off in others.** The semantics aren't obvious. Got me a route through some random pool that 30% impact, then I added it and the same swap suddenly had no route. So it's binary, not a smart filter.

**`maxRetries` on `sendRawTransaction` is unrelated to Jupiter but the docs hand wave it.** A user with a flaky RPC will see swaps silently retry without telling them. Add an example showing how to wait for confirmation properly with `confirmTransaction` and a `lastValidBlockHeight`. The minimal example in the docs glosses over this.

**Latency.** The lite host has noticeable extra latency on quote calls compared to api.jup.ag. Expected, but quantify it. Tell me "lite is slower by ~200ms p50, ~800ms p99" so I can decide.

## 4. The AI stack

Honestly I did not use Skills, the CLI, or the Docs MCP for this build. I went straight to the regular docs and figured it out. Two reasons:

1. The first time I landed on developers.jup.ag I did not see a giant call out that an MCP server existed. If it was there, it didn't catch me.
2. Even if I knew, switching IDE context to install an MCP for one API integration is friction.

What would have actually helped:

An inline "ask the docs" thing on every page, that already knows my context (which endpoint page I'm on) and answers in working code. Not a chatbot popup. An input box at the top of the page. I type "how do I swap SOL into BONK with 1% slippage and a priority fee for fast settlement", I get back the exact fetch call, paramaterized, with my pubkey placeholder, ready to paste. Not "here are the relevant pages, go read them".

The MCP idea is right, the surface needs to be in the IDE everyone already uses. Cursor, Windsurf, Cline. Make installation a single button on developers.jup.ag that opens the right modal in the right tool.

What I would want from a Jupiter Skill specifically: a "build me a Jupiter swap component" that scaffolds the React file, the wallet wiring, the balance check, the buffer logic, and the error handling. Right now every team rebuilds the same boilerplate. That is your wedge.

## 5. How I would rebuild developers.jup.ag

Land users on a working playground. Not a hero section, not a feature grid. The first thing on the page is a live quote panel:

- Input mint dropdown (defaults to SOL)
- Output mint dropdown (defaults to USDC)
- Amount field (defaults to 0.1)
- "Get Quote" button
- Right pane shows the actual JSON response, syntax highlighted

Below that, three tabs: `fetch`, `@solana/web3.js`, `Rust`. Each one shows the exact code that produces what's on screen. Copy button on every snippet. The user is interfacing with your API in 5 seconds, not 5 minutes.

Then a "Connect Phantom" button. Same panel, but now the swap actually executes against your wallet on devnet (or mainnet with a tiny amount). Sign, submit, see the tx hash, click through to Solscan. The full loop in the browser. No CLI. No npm install.

Other things I would do:

**Single page that explains the host split.** Big banner. "Free? Use lite-api.jup.ag. Have an API key? Use api.jup.ag. Same endpoints either way." Done.

**A real status page.** Not a generic uptime widget. Per endpoint p50/p99 latency in the last hour. Last incident. Current rate limit ceilings per tier.

**Versioning page.** v1, v2, v3 of every endpoint. What is current. What is deprecated. When does deprecated turn off. Right now this is a rumor.

**Real cookbook.** Not "examples". Cookbook. With recipes. "Swap SOL to a token without leaving the user dust". "Detect failed swaps before broadcasting". "Display realtime price for a list of memecoins". "Build a portfolio page using Jupiter price + RPC". Each recipe is a 50 line file you can fork.

**Error code reference.** Every error your APIs can return, what triggers it, what to do about it. Solana ecosystem is full of half documented `0x1` errors. Be the platform that doesn't.

**Stop burying the API base URLs.** I should be able to find them in 1 click from the homepage. Currently it takes 3.

**A SOL balance helper endpoint.** `GET /v1/wallet/{pubkey}/swappable-sol` that returns max SOL you can swap given current network fee estimate, accounting for ATA creation if the destination ATA doesn't exist. Every memecoin terminal needs this. We all build it ourselves. Just give it to us.

## 6. What I wish existed

A first class typed TypeScript SDK that is not auto generated from OpenAPI. Hand crafted, opinionated, batteries included.

```ts
import { Jupiter } from "@jup-ag/sdk";
const jup = new Jupiter({ apiKey: process.env.JUP_KEY, rpc: heliusUrl });
const tx = await jup.swap({
  from: SOL_MINT,
  to: bonkMint,
  amount: 0.1,
  walletPubkey: user,
  reserveSol: 0.005,
});
```

That handles balance check, ATA detection, priority fee tier selection, simulation, and returns me a `VersionedTransaction` ready to sign. Right now I write 80 lines of glue for that. Multiplied by every team using Jupiter.

Other wishes:

**A bulk price endpoint that takes 1000 mints, not 100.** I track hundreds of memecoins. 10 batched calls per refresh cycle is silly.

**Webhooks for swap settlement.** Instead of polling `confirmTransaction`, register a callback URL, get told when the tx I submitted lands or fails. Saves me sustaining a Solana RPC connection for every user.

**A "is this mint live and tradeable" cheap endpoint.** Not the full quote API. A boolean plus current liquidity. I want to filter dead tokens from a list of 500 candidates without burning 500 quote calls.

**Submit + confirm in one call.** I sign on the client, send the signed tx to a Jupiter endpoint, Jupiter handles retries, Jito bundling if needed, returns me the final status. Right now I'm doing that orchestration myself with a third party RPC.

**Better swap response.** Include the lookup tables I should warm. Include the destination ATA address (so I can show "you'll need to create this account, costs 0.002 SOL"). Include the expected priority fee actually being applied. Right now I have to compute or guess.

**A clear API key model with self serve console.** Sign in with wallet. Generate a key. See your usage. Upgrade tier. None of that exists in any clear way that I found.

**A deeplink builder for `jup.ag/swap/IN-OUT`** with optional amount prefilled. I do this manually in my fallback button. Just expose it as `Jupiter.swapDeeplink(input, output, amount)` in the SDK.

**Stable token list with diff feeds.** I cache the verified token list. Tell me which tokens were added or removed since timestamp X so I can update incrementally instead of re fetching the whole thing.

**Documentation for partner programs.** Bags, Pump.fun, your own launchpad. How does fee sharing work when the swap originates from a partner integration. Not clear.

## TL;DR

The APIs work. They are fast enough. The endpoint surface is solid for swap and quote. Where Jupiter is currently weakest:

1. The free vs paid host split is invisible until you stub your toe
2. Failure modes during swap (insufficient SOL, dead routes, price impact lies) are silent and hand them to the integrator
3. Two parallel versions of the price API with no migration story
4. No first class SDK, every team writes the same 200 lines of glue
5. Documentation is page based reference, not recipe based outcomes
6. AI surface (MCP, Skills) needs to be the front door, not a tab

If I were the engineer behind the platform, I would land users on a live playground that signs and submits a real tx in the browser within 60 seconds, and I would ship one canonical SDK that solves the SOL buffer, ATA detection, and confirmation orchestration so nobody has to write that code ever again.

The product is good. The path to first working code is longer than it should be.
