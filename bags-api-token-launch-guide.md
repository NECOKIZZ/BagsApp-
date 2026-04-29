# Bags API — Complete Token Launch Integration Guide

> Teaching document for integrating the Bags API to launch Solana tokens, including all required and optional fields, the full 5-step flow, fee sharing, and error handling.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Base URL & Rate Limits](#base-url--rate-limits)
4. [The Token Launch Flow (5 Steps)](#the-token-launch-flow-5-steps)
5. [Step 1 — Create Token Info & Metadata](#step-1--create-token-info--metadata)
6. [Step 2 — Create Fee Share Configuration](#step-2--create-fee-share-configuration)
7. [Step 3 — Create the Launch Transaction](#step-3--create-the-launch-transaction)
8. [Step 4 — Sign the Transaction](#step-4--sign-the-transaction)
9. [Step 5 — Broadcast the Transaction](#step-5--broadcast-the-transaction)
10. [Fee Sharing Rules & BPS Logic](#fee-sharing-rules--bps-logic)
11. [Lookup Tables (LUTs) for Many Claimers](#lookup-tables-luts-for-many-claimers)
12. [Partner Configuration](#partner-configuration)
13. [Meteora Config Types (Fee Structures)](#meteora-config-types-fee-structures)
14. [Full TypeScript Example](#full-typescript-example)
15. [CLI Alternative](#cli-alternative)
16. [Error Handling](#error-handling)
17. [Common Errors & Fixes](#common-errors--fixes)

---

## Overview

The Bags API lets you launch Solana tokens programmatically. Every token launch goes through these steps:

```
Create Metadata → Create Fee Share Config → Get Launch Transaction → Sign → Broadcast
```

**Key facts:**
- Base URL: `https://public-api-v2.bags.fm/api/v1`
- All requests need the header: `x-api-key: YOUR_API_KEY`
- Token Launch v2 **requires** fee sharing configuration — even if you want 100% of fees for yourself
- The SDK (`@bagsfm/bags-sdk`) wraps all endpoints and is the recommended integration path

---

## Authentication

### Getting an API Key

1. Visit [dev.bags.fm](https://dev.bags.fm) and sign in
2. Navigate to **API Keys**
3. Click **Create API key**
4. You can have up to **10 active API keys**

### Using Your API Key

Include it as a header on every request:

```bash
curl -X POST 'https://public-api-v2.bags.fm/api/v1/token-launch/create-token-info' \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'Content-Type: application/json'
```

```javascript
const response = await fetch('https://public-api-v2.bags.fm/api/v1/endpoint', {
  headers: { 'x-api-key': 'YOUR_API_KEY' }
});
```

---

## Base URL & Rate Limits

| Property | Value |
|---|---|
| Base URL | `https://public-api-v2.bags.fm/api/v1` |
| Rate Limit | 1,000 requests per hour (per user + per IP) |
| Rate Limit Header | `X-RateLimit-Remaining` / `X-RateLimit-Reset` |

> **Tip:** Spread requests evenly and implement exponential backoff for 429 responses.

---

## The Token Launch Flow (5 Steps)

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1  POST /token-launch/create-token-info                   │
│          Upload image + metadata → get tokenMint + metadataUrl  │
├─────────────────────────────────────────────────────────────────┤
│  Step 2  POST /fee-share/config                                 │
│          Set who gets fees + what % → get configKey             │
├─────────────────────────────────────────────────────────────────┤
│  Step 3  POST /token-launch/create-launch-transaction           │
│          Combine mint + configKey → get unsigned tx             │
├─────────────────────────────────────────────────────────────────┤
│  Step 4  Sign the transaction with your Solana keypair          │
├─────────────────────────────────────────────────────────────────┤
│  Step 5  POST /solana/send-transaction (or Jito bundle)         │
│          Broadcast signed tx → token is live                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Create Token Info & Metadata

**Endpoint:** `POST /token-launch/create-token-info`  
**Content-Type:** `multipart/form-data`

This step uploads your token image to IPFS and creates the on-chain metadata record. It returns the **token mint address** and **metadata URL** you'll need in later steps.

### Request Fields

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `name` | string | ✅ Yes | max 32 chars | Token name (e.g. "My Token") |
| `symbol` | string | ✅ Yes | max 10 chars; auto-uppercased | Ticker symbol (e.g. "MTK", no `$`) |
| `description` | string | ✅ Yes | max 1000 chars | Token description |
| `image` | binary file | ✅ One of these | max 15 MB | Token image file upload |
| `imageUrl` | string (URI) | ✅ One of these | must be publicly accessible | URL to token image |
| `metadataUrl` | string (URI) | ❌ Optional | JSON must match fields | Pre-existing metadata URL — skips IPFS upload |
| `telegram` | string | ❌ Optional | — | Telegram group/channel URL |
| `twitter` | string | ❌ Optional | — | Twitter/X profile URL |
| `website` | string | ❌ Optional | — | Project website URL |

**Image rule:** Provide **either** `image` OR `imageUrl` — not both. If `metadataUrl` is supplied, you can pair it with `imageUrl` but not with `image`.

### Response

```json
{
  "success": true,
  "response": {
    "tokenMint": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "tokenMetadata": "https://ipfs.io/ipfs/Qm...",
    "tokenLaunch": {
      "name": "My Token",
      "symbol": "MTK",
      "description": "...",
      "image": "https://...",
      "tokenMint": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "status": "PRE_LAUNCH",
      "twitter": "https://x.com/mytoken",
      "website": "https://mytoken.com",
      "telegram": null,
      "launchWallet": null,
      "launchSignature": null,
      "uri": null,
      "createdAt": "2025-04-01T00:00:00.000Z",
      "updatedAt": "2025-04-01T00:00:00.000Z"
    }
  }
}
```

### Key Response Fields

| Field | Description |
|---|---|
| `tokenMint` | Solana public key of the new token — **save this** |
| `tokenMetadata` | IPFS URL of the metadata JSON — **save this** |
| `status` | One of: `PRE_LAUNCH`, `PRE_GRAD`, `MIGRATING`, `MIGRATED` |

### SDK Equivalent

```typescript
const tokenInfoResponse = await sdk.tokenLaunch.createTokenInfoAndMetadata({
  imageUrl: "https://example.com/image.png",
  name: "My Token",
  symbol: "MTK",           // No $ prefix, auto-uppercased
  description: "My token description",
  twitter: "https://x.com/mytoken",
  website: "https://mytoken.com",
  telegram: "https://t.me/mytoken",  // optional
});

const tokenMint = tokenInfoResponse.tokenMint;     // PublicKey string
const metadataUrl = tokenInfoResponse.tokenMetadata; // IPFS URL
```

---

## Step 2 — Create Fee Share Configuration

**Endpoint:** `POST /fee-share/config`  
**Content-Type:** `application/json`

Every token launch **must** have a fee share config. This defines who receives trading fees and in what proportion. Even if you want 100% of fees, you must explicitly declare it.

### Request Fields

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `payer` | string | ✅ Yes | Solana public key | Wallet paying for the config transaction |
| `baseMint` | string | ✅ Yes | Solana public key | The token mint from Step 1 |
| `claimersArray` | string[] | ✅ Yes | 1–100 entries | Array of wallet public keys that receive fees |
| `basisPointsArray` | number[] | ✅ Yes | 1–100 entries; must sum to **10000** | BPS (basis points) for each claimer. 10000 = 100% |
| `partner` | string | ❌ Optional | Solana public key | Partner wallet address for partner fee sharing |
| `partnerConfig` | string | ❌ Optional | Solana public key PDA | Partner config PDA (required if `partner` is set) |
| `additionalLookupTables` | string[] | ❌ Optional | Required when >7 claimers | Lookup table addresses for large claimer sets |
| `bagsConfigType` | string (UUID) | ❌ Optional | See Meteora Config Types | Determines fee structure/percentages |
| `tipWallet` | string | ❌ Optional | Solana public key | Tip recipient wallet |
| `tipLamports` | number | ❌ Optional | lamports | Tip amount in lamports |

### BPS Quick Reference

| BPS Value | Percentage |
|---|---|
| 10000 | 100% |
| 5000 | 50% |
| 3000 | 30% |
| 1000 | 10% |
| 100 | 1% |

### Response

```json
{
  "success": true,
  "response": {
    "needsCreation": true,
    "feeShareAuthority": "...",
    "meteoraConfigKey": "ABC123...",   // <-- use this as configKey in Step 3
    "transactions": [...],             // sign and send these in order
    "bundles": [...]                   // send via Jito if present
  }
}
```

**`meteoraConfigKey`** is what you pass as `configKey` in Step 3.

### SDK Equivalent

```typescript
// Scenario: Creator keeps 100% of fees
const feeClaimers = [{ user: keypair.publicKey, userBps: 10000 }];

// Scenario: Split fees (creator 40%, partner A 30%, partner B 30%)
const feeClaimers = [
  { user: creatorPublicKey, userBps: 4000 },
  { user: partnerAPublicKey, userBps: 3000 },
  { user: partnerBPublicKey, userBps: 3000 },
];

const configResult = await sdk.config.createBagsFeeShareConfig({
  payer: keypair.publicKey,
  baseMint: tokenMint,           // PublicKey from Step 1
  feeClaimers: feeClaimers,
  partner: partnerWallet,        // optional
  partnerConfig: partnerConfigPDA, // optional
});

const configKey = configResult.meteoraConfigKey; // PublicKey — save this
```

---

## Step 3 — Create the Launch Transaction

**Endpoint:** `POST /token-launch/create-launch-transaction`  
**Content-Type:** `application/json`

Combines everything from Steps 1 and 2 into an unsigned Solana transaction.

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `ipfs` | string | ✅ Yes | The `tokenMetadata` IPFS URL from Step 1 |
| `tokenMint` | string | ✅ Yes | The `tokenMint` public key from Step 1 |
| `wallet` | string | ✅ Yes | Public key of the wallet launching the token |
| `initialBuyLamports` | number | ✅ Yes | Amount of SOL (in lamports) to buy on launch. `0.01 SOL = 10_000_000 lamports` |
| `configKey` | string | ✅ Yes | The `meteoraConfigKey` from Step 2 |
| `tipWallet` | string | ❌ Optional | Jito tip recipient wallet public key |
| `tipLamports` | number | ❌ Optional | Tip amount in lamports |

### Lamports Reference

| SOL | Lamports |
|---|---|
| 0.001 SOL | 1,000,000 |
| 0.01 SOL | 10,000,000 |
| 0.1 SOL | 100,000,000 |
| 1 SOL | 1,000,000,000 |

### Response

```json
{
  "success": true,
  "response": "BASE58_ENCODED_SERIALIZED_TRANSACTION"
}
```

The response is a **base58-encoded serialized VersionedTransaction** ready to be signed.

### SDK Equivalent

```typescript
const tokenLaunchTransaction = await sdk.tokenLaunch.createLaunchTransaction({
  metadataUrl: metadataUrl,               // from Step 1
  tokenMint: tokenMint,                   // PublicKey from Step 1
  launchWallet: keypair.publicKey,
  initialBuyLamports: 0.01 * LAMPORTS_PER_SOL,  // 0.01 SOL
  configKey: configKey,                   // PublicKey from Step 2
});
```

---

## Step 4 — Sign the Transaction

Sign the transaction returned from Step 3 using your Solana keypair.

```typescript
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));

// Deserialize
const txBytes = bs58.decode(base58Transaction);
const transaction = VersionedTransaction.deserialize(txBytes);

// Sign
transaction.sign([keypair]);
```

> **Note:** When using the SDK helpers (`signAndSendTransaction`), signing and broadcasting are combined into one call.

---

## Step 5 — Broadcast the Transaction

**Endpoint:** `POST /solana/send-transaction`

Send the signed transaction to the Solana network.

```json
{
  "transaction": "SIGNED_BASE58_ENCODED_TRANSACTION"
}
```

Or use Jito bundles for higher landing probability (recommended for token launches):

```typescript
// SDK handles Jito bundling
const signature = await signAndSendTransaction(connection, commitment, tokenLaunchTransaction, keypair);

console.log("Token live at: https://bags.fm/" + tokenMint.toString());
```

---

## Fee Sharing Rules & BPS Logic

These rules are **enforced by the API** — violating them returns a 400 error.

### Rule 1: BPS must sum to exactly 10,000

```
creator BPS + all fee claimer BPS = 10,000
```

```typescript
// ✅ Valid
[{ bps: 10000 }]                          // creator gets all
[{ bps: 5000 }, { bps: 5000 }]           // 50/50 split
[{ bps: 4000 }, { bps: 3000 }, { bps: 3000 }]  // 40/30/30

// ❌ Invalid (API returns 400)
[{ bps: 5000 }, { bps: 3000 }]           // only sums to 8000
[{ bps: 6000 }, { bps: 6000 }]           // exceeds 10000
```

### Rule 2: Creator BPS must always be set explicitly

The creator's wallet must appear in the `claimersArray` with their share set explicitly. The API does **not** automatically assign remaining BPS to the creator.

```typescript
// ✅ Correct: creator explicitly listed with full BPS
claimersArray: [creatorWallet],
basisPointsArray: [10000]

// ✅ Correct: creator explicitly listed with their cut
claimersArray: [creatorWallet, partnerWallet],
basisPointsArray: [7000, 3000]

// ❌ Wrong: creator not listed at all
claimersArray: [partnerWallet],
basisPointsArray: [10000]  // partner gets everything
```

### Rule 3: Maximum 100 fee claimers

The `claimersArray` and `basisPointsArray` each support up to 100 entries.

### Rule 4: Supported social platforms for username lookup

When using the SDK's social username → wallet lookup (`sdk.state.getLaunchWalletV2()`):

| Provider | String |
|---|---|
| Twitter / X | `"twitter"` |
| Kick | `"kick"` |
| GitHub | `"github"` |

```typescript
// Look up a wallet by social username
const result = await sdk.state.getLaunchWalletV2("username", "twitter");
const wallet = result.wallet; // PublicKey
```

---

## Lookup Tables (LUTs) for Many Claimers

When you have **more than 15 fee claimers**, you must create Address Lookup Tables (LUTs) before creating the fee share config. The SDK handles this automatically:

```typescript
if (feeClaimers.length > BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT) {
  const lutResult = await sdk.config.getConfigCreationLookupTableTransactions({
    payer: creatorWallet,
    baseMint: tokenMint,
    feeClaimers: feeClaimers,
  });

  // 1. Send LUT creation transaction
  await signAndSendTransaction(connection, commitment, lutResult.creationTransaction, keypair);

  // 2. Wait one slot (required by Solana before extending)
  await waitForSlotsToPass(connection, commitment, 1);

  // 3. Send all extend transactions
  for (const extendTx of lutResult.extendTransactions) {
    await signAndSendTransaction(connection, commitment, extendTx, keypair);
  }

  // 4. Pass LUT addresses to fee share config creation
  await sdk.config.createBagsFeeShareConfig({
    ...params,
    additionalLookupTables: lutResult.lutAddresses,
  });
}
```

---

## Partner Configuration

Partners are wallets that receive a share of fees from token launches that include their partner config. This is useful for platforms or aggregators that want to collect fees across multiple token launches.

### Creating a Partner Key

Before using a partner config, a partner key must be created once per wallet via the `POST /partner/config` endpoint or the Bags Dev Dashboard.

```typescript
// Include partner in fee share config
await sdk.config.createBagsFeeShareConfig({
  payer: creatorWallet,
  baseMint: tokenMint,
  feeClaimers: feeClaimers,
  partner: partnerWalletPublicKey,     // Partner's wallet
  partnerConfig: partnerConfigPDA,      // Derived PDA
});
```

---

## Meteora Config Types (Fee Structures)

The `bagsConfigType` field in the fee share config endpoint controls the fee percentages applied to trades. Pass the UUID string as the value.

| UUID | Pre-Migration Fee | Post-Migration Fee | Fee Compounding |
|---|---|---|---|
| `fa29606e-5e48-4c37-827f-4b03d58ee23d` | 2% | 2% | 25% (default) |
| `d16d3585-6488-4a6c-9a6f-e6c39ca0fda3` | 0.25% | 1% | 50% |
| `a7c8e1f2-3d4b-5a6c-9e0f-1b2c3d4e5f6a` | 1% | 0.25% | 50% |
| `48e26d2f-0a9d-4625-a3cc-c3987d874b9e` | 10% | 10% | 50% |

The **default** (`fa29606e...`) applies if you omit this field.

---

## Full TypeScript Example

```typescript
import dotenv from "dotenv";
dotenv.config();

import {
  BagsSDK,
  signAndSendTransaction,
  createTipTransaction,
  sendBundleAndConfirm,
} from "@bagsfm/bags-sdk";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";

// ── Setup ──────────────────────────────────────────────────────────
const connection = new Connection(process.env.SOLANA_RPC_URL!);
const sdk = new BagsSDK(process.env.BAGS_API_KEY!, connection, "processed");
const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));

async function launchToken() {
  // ── Step 1: Create token metadata ──────────────────────────────
  const tokenInfo = await sdk.tokenLaunch.createTokenInfoAndMetadata({
    imageUrl: "https://example.com/my-token-image.png",
    name: "My Token",           // max 32 chars
    symbol: "MTK",              // max 10 chars, auto-uppercased
    description: "My token.",   // max 1000 chars
    twitter: "https://x.com/mytoken",   // optional
    website: "https://mytoken.com",     // optional
    telegram: "https://t.me/mytoken",   // optional
  });

  const tokenMint = new PublicKey(tokenInfo.tokenMint);
  const metadataUrl = tokenInfo.tokenMetadata;
  console.log("Token mint:", tokenMint.toString());

  // ── Step 2: Fee share config (creator keeps 100%) ───────────────
  const feeClaimers = [{ user: keypair.publicKey, userBps: 10000 }];

  const configResult = await sdk.config.createBagsFeeShareConfig({
    payer: keypair.publicKey,
    baseMint: tokenMint,
    feeClaimers,
  });

  // Sign and send any config transactions
  for (const tx of configResult.transactions || []) {
    await signAndSendTransaction(connection, "processed", tx, keypair);
  }

  const configKey = configResult.meteoraConfigKey;
  console.log("Config key:", configKey.toString());

  // ── Step 3: Create launch transaction ──────────────────────────
  const launchTx = await sdk.tokenLaunch.createLaunchTransaction({
    metadataUrl: metadataUrl,
    tokenMint: tokenMint,
    launchWallet: keypair.publicKey,
    initialBuyLamports: 0.01 * LAMPORTS_PER_SOL,  // 0.01 SOL initial buy
    configKey: configKey,
  });

  // ── Steps 4 & 5: Sign and broadcast ────────────────────────────
  const signature = await signAndSendTransaction(connection, "processed", launchTx, keypair);

  console.log("✅ Token launched!");
  console.log("Signature:", signature);
  console.log("View at: https://bags.fm/" + tokenMint.toString());
}

launchToken().catch(console.error);
```

### Environment Variables

```bash
# .env
BAGS_API_KEY=your_api_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
PRIVATE_KEY=your_base58_encoded_private_key
```

### Installation

```bash
npm install @bagsfm/bags-sdk @solana/web3.js bs58 dotenv
```

---

## CLI Alternative

The Bags CLI wraps the entire 5-step flow into one command.

### Install

```bash
npm install -g @bagsfm/bags-cli
```

### Launch with all fees to creator

```bash
bags launch create \
  --name "My Token" \
  --symbol "MTK" \
  --description "A great token" \
  --image-url "https://example.com/image.png" \
  --initial-buy 10000000 \
  --skip-confirm
```

### Launch with fee sharing

```bash
bags launch create \
  --name "My Token" \
  --symbol "MTK" \
  --description "A great token" \
  --image-url "https://example.com/image.png" \
  --initial-buy 10000000 \
  --fee-claimers '[{"provider":"twitter","username":"user1","bps":3000},{"provider":"twitter","username":"user2","bps":2000}]' \
  --skip-confirm
# Creator automatically receives remaining 5000 BPS (50%)
```

### Launch with partner config

```bash
bags launch create \
  --name "My Token" \
  --symbol "MTK" \
  --description "A great token" \
  --image-url "https://example.com/image.png" \
  --initial-buy 10000000 \
  --partner PARTNER_WALLET_PUBKEY \
  --partner-config PARTNER_CONFIG_PDA \
  --skip-confirm
```

> Omit flags to enter an interactive wizard mode.

---

## Error Handling

### Response Format

All responses share a consistent envelope:

```json
// Success
{ "success": true, "response": { /* data */ } }

// Error
{ "success": false, "error": "Detailed error message" }
```

### Status Codes

| Code | Meaning | Action |
|---|---|---|
| 400 | Bad Request — validation failed | Fix request params |
| 401 | Unauthorized — bad/missing API key | Check `x-api-key` header |
| 403 | Forbidden — no permission | Check API key scopes |
| 404 | Not Found | Check endpoint path |
| 413 | Payload Too Large — image > 15 MB | Compress or resize image |
| 429 | Rate Limited — >1000 req/hour | Wait; use `X-RateLimit-Reset` |
| 500 | Server Error | Retry with exponential backoff |

### Retry Strategy

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable = error.status === 429 || error.status >= 500;
      if (!isRetryable || attempt === maxAttempts) throw error;
      const waitMs = Math.min(1000 * 2 ** attempt, 30000); // exp backoff, max 30s
      await new Promise(res => setTimeout(res, waitMs));
    }
  }
  throw new Error("Max retries exceeded");
}
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `"Invalid API key"` | Missing or wrong `x-api-key` header | Get key from [dev.bags.fm](https://dev.bags.fm) |
| `"BPS must sum to 10000"` | `basisPointsArray` doesn't total 10,000 | Adjust BPS values to sum exactly to 10,000 |
| `"Token name is required and must be between 1-32 characters"` | `name` missing or too long | Keep name ≤ 32 characters |
| `"Image file must be under 15MB"` | File upload too large | Compress image or use `imageUrl` |
| `"Invalid fee claimer"` | Social username not found | Verify provider + username; user must have a registered Bags wallet |
| `"Rate limit exceeded"` | >1000 requests/hour | Implement backoff; spread requests |
| `"Insufficient SOL"` | Wallet has no SOL | Fund wallet before launching |
| Private key error | Wrong encoding | Key must be **base58 encoded** (not byte array) |

---

## Quick Reference — Required Fields Summary

### `POST /token-launch/create-token-info` (Required)

```
name          string   max 32 chars
symbol        string   max 10 chars
description   string   max 1000 chars
image OR imageUrl      one must be provided
```

### `POST /fee-share/config` (Required)

```
payer              string   your wallet public key
baseMint           string   tokenMint from Step 1
claimersArray      string[] wallet public keys (1–100)
basisPointsArray   number[] BPS per claimer; MUST sum to 10000
```

### `POST /token-launch/create-launch-transaction` (Required)

```
ipfs                string   tokenMetadata URL from Step 1
tokenMint           string   tokenMint from Step 1
wallet              string   your wallet public key
initialBuyLamports  number   SOL × 1,000,000,000
configKey           string   meteoraConfigKey from Step 2
```

---

*Source: [docs.bags.fm](https://docs.bags.fm) — fetched April 2026*
