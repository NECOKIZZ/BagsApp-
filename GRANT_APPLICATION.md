# Agentic Engineering Grant Application — Delphi

**Submit at:** https://superteam.fun/earn/grants/agentic-engineering
**Amount:** 200 USDG
**Files to attach:** `claude-session.jsonl` (exported to project root)

---

## Step 1: Basics

**Project Title**
> Delphi

**One Line Description**
> AI powered intelligence terminal for Solana memecoin discovery and launch. Track crypto Twitter, score tokens with onchain data, swap and launch from one dashboard.

**TG username**
> t.me/web3fran

**Wallet Address**
> ESAk6XtrBPMqUHpbQdTmkJvYFsLUAf1b9f1GLWzLKD9e

---

## Step 2: Details

**Project Details**

> Delphi is a real time intelligence terminal that turns crypto Twitter noise into actionable token signals on Solana. The product solves three problems at once. First, traders waste hours sifting through thousands of daily tweets to find the few token mentions that actually matter. Second, by the time most narratives go viral the first ten minutes of price action are already gone, which is where the majority of memecoin gains are made. Third, launching a token currently means juggling Pump.fun, Bags, Jupiter, and a wallet across multiple tabs with no unified view of what's actually working.
>
> Delphi ingests tweets from curated crypto accounts in real time, runs them through a two stage Claude powered pipeline that extracts entity mentions and matches them against a live token corpus with time decay scoring. Every token gets a proprietary 100 point Scratch Score (v2) that fuses DexScreener volume, holder distribution, liquidity depth, Jupiter verification status, transaction activity, and social signal into a single comparable number. Users can swap any token through an integrated Jupiter aggregator widget, launch new tokens via the Bags API, and track portfolio performance, all without leaving the app.
>
> The stack is React plus TypeScript plus Vite on the front, Node plus Express plus Supabase on the back, with Phantom wallet signature auth, Helius RPC, and the Anthropic API powering the narrative engine. The product is live in beta and ships continuously, with the entire codebase developed in tight loops with agentic AI tools.

**Deadline**
> 31 May 2026 (Asia/Calcutta timezone)

**Proof of Work**

> Live product and continuous shipping cadence. Recent commits over the past two weeks alone include:
>
> - `fix(swap): contain SOL selector in 'You pay' box + add Jupiter fallback link` (a0f5a47)
> - `fix(swap): add SOL balance buffer check + enable preflight to prevent failed onchain txs` (4e5705e)
> - `fix(swap): use VITE_SOLANA_RPC env var instead of public RPC to avoid 403` (cc993ec)
> - `fix: deduplicate narrative pipeline — skip already-processed tweets` (08d7eaa)
> - `fix: correct Jupiter API endpoints, add token metrics enrichment cron for all tokens, improve swap tx confirmation` (0bf0595)
> - `feat: pull-to-refresh, dedicated swap page with Jupiter API, fix feed scroll restoration` (89429e9)
> - `Add GET /api/top-tokens endpoint for Delphi Agent` (48e9c98)
> - `fix: Bags token scoring accuracy` (75b3440)
> - `fix(ui): silent terminal refresh + persist feed scroll/narrative/tweet across navigation` (650134f)
>
> Full git history: https://github.com/NECOKIZZ/Delphi/commits/main
>
> Repository: https://github.com/NECOKIZZ/Delphi
>
> Architecture and design documentation shipped in repo:
> - `PROJECT_DOCS.md` (full technical spec)
> - `INVESTOR_PITCH.md` (investor deck markdown)
> - `SCORING_SYSTEM.md` and `SCORING_FORMULA_PROOF.md` (v2 scoring algorithm with audit)
> - `NARRATIVE_MATCHING_SPEC.md` (two stage AI pipeline spec)
> - `BAGSAPP_UI_SPEC.md` (full UI spec)
> - `BRAND_GUIDELINES.md` (visual identity system)
> - `JUPITER_DX_FEEDBACK.md` (developer experience writeup for Jupiter platform)
>
> Agentic development evidence: every commit above was produced in collaboration with Cascade (Windsurf) and Claude. The exported session transcript `claude-session.jsonl` in the project root captures a representative live debugging session where a Solana RPC 403 bug, a swap insufficient lamports failure, and a flexbox overflow bug were all diagnosed and fixed in real time using agentic tooling.

**Demo Video**
> https://youtu.be/PyqxPdFzazc

**Personal X Profile**
> x.com/0xnecokizz

**Personal GitHub Profile**
> github.com/NECOKIZZ
> (confirm or replace if a different personal handle)

**Colosseum Crowdedness Score**
> https://drive.google.com/file/d/18895bqomxU_b2ERtA-eEgHh5PUwQgDfC/view?usp=sharing
> https://drive.google.com/file/d/1aB8GUlBMIlufkzV1JrF7bStQDKqw8kzE/view?usp=sharing

**AI Session Transcript**
> Attached file: `claude-session.jsonl` (in project root)
> Size: ~20KB, captures a real agentic engineering session
> Upload this file directly to the form's attachment field.

---

## Step 3: Milestones

**Goals and Milestones**

> Milestone 1 (Week 1): Ship production grade swap experience with full balance pre flight, Jupiter aggregator integration, Jupiter fallback deeplink, and zero failed onchain transactions from insufficient SOL. **Status: shipped this week, see commits 4e5705e, a0f5a47, 4df552c.**
>
> Milestone 2 (Week 2): Launch the narrative engine v2. Two stage Claude powered tweet entity extraction plus semantic token relevance scoring with time decay. Cross check against DexScreener for liquidity validation. **Status: shipping now, see NARRATIVE_MATCHING_SPEC.md.**
>
> Milestone 3 (Week 3-4): Ship the Bags token launch flow end to end. From "click tokenize on a tweet" to a signed Solana transaction creating the token with metadata, fee share configuration, and immediate Jupiter aggregator visibility. **Status: API integration complete (see bags-api-token-launch-guide.md), UI in progress.**
>
> Milestone 4 (Week 5-6): Public beta launch with onboarding for the first 100 active traders. Phantom wallet auth, portfolio tracking, hot strip feed, mobile responsive.
>
> Milestone 5 (Week 7-8): Auto buy agents and watchlist alerts. Users define narrative filters + score thresholds + max buy size, and Delphi executes trades when matches hit.

**Primary KPI**
> Weekly active traders executing at least one swap or launch through the Delphi terminal. Target: 100 WAU by end of milestone 4, 500 WAU by end of milestone 5.
> (Confirm or swap for another metric like total swap volume in USD, total tokens launched, or daily active sessions.)

**Final tranche checkbox**
> Confirmed. To receive final tranche, will submit:
> - Colosseum project link
> - GitHub repository: https://github.com/NECOKIZZ/Delphi
> - AI subscription receipt (Claude Code Pro / Cursor / Windsurf, whichever applies)

---

## Submission Checklist

Before you submit, make sure you have:

- [x] Filled in TG username
- [x] Filled in Solana wallet address
- [x] Filled in personal X handle
- [x] Confirmed GitHub handle
- [x] Set a specific deadline date
- [x] Generated and uploaded the Colosseum Crowdedness Score screenshot
- [ ] Attached `claude-session.jsonl` to the form (manual upload at submit time)
- [x] Reviewed Project Details and Proof of Work copy
- [x] Confirmed Primary KPI

## Files In Project Root For This Application

| File | Purpose |
|------|---------|
| `claude-session.jsonl` | AI session proof of work (auto exported via apply-grant skill) |
| `GRANT_APPLICATION.md` | This document, copy paste source for the form |
| `JUPITER_DX_FEEDBACK.md` | Bonus: Jupiter developer experience report |

**Submit here:** https://superteam.fun/earn/grants/agentic-engineering
