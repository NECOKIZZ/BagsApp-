import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";
import { getPhantom, hasAnySolanaWallet, type PhantomProvider } from "./phantom";
import {
  postLaunch,
  submitLaunchSignedTx,
  requestWalletNonce,
  verifyWalletSignature,
  type LaunchPayload,
} from "./api";

export type LaunchStep =
  | "connecting_wallet"
  | "authenticating"
  | "creating_token"
  | "signing_transaction"
  | "submitting_transaction"
  | "done";

export type LaunchResult = {
  mintUrl?: string;
  signature?: string;
  launchId: string;
  /** Solana mint address of the launched token, if available. */
  tokenMint?: string;
};

export type LaunchAuth = {
  walletAddress: string | null;
  authToken: string | null;
  setWalletAddress: (a: string) => void;
  setAuthToken: (t: string) => void;
};

/**
 * End-to-end Bags launch. Connects Phantom (if needed), gets a server session,
 * starts a launch, and runs the multi-tx signing loop. Reports progress via `onStep`.
 */
export async function runBagsLaunch(
  payload: Omit<LaunchPayload, "wallet">,
  auth: LaunchAuth,
  onStep: (step: LaunchStep, detail?: string) => void,
): Promise<LaunchResult> {
  // ── 1. Wallet ────────────────────────────────────────────────
  onStep("connecting_wallet");
  const provider: PhantomProvider | null = getPhantom();
  if (!provider) {
    throw new Error(
      hasAnySolanaWallet()
        ? "Detected a Solana wallet but it isn't compatible. Use Phantom (phantom.app)."
        : "No Solana wallet found. Install Phantom (phantom.app) and refresh.",
    );
  }
  const { publicKey } = await provider.connect();
  const address = publicKey.toString();
  auth.setWalletAddress(address);

  if (!provider.signTransaction) {
    throw new Error("This wallet cannot sign Solana transactions here.");
  }

  // ── 2. Auth (nonce + signMessage) ────────────────────────────
  let token = auth.authToken;
  if (!token) {
    if (!provider.signMessage) {
      throw new Error("This wallet does not support signMessage; cannot authenticate.");
    }
    onStep("authenticating");
    const { nonce, message } = await requestWalletNonce(address);
    const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
    const signatureB64 = btoa(String.fromCharCode(...signed.signature));
    const verified = await verifyWalletSignature({ address, nonce, signature: signatureB64 });
    token = verified.token;
    auth.setAuthToken(token);
    localStorage.setItem("walletAddress", verified.address);
    localStorage.setItem("walletAuthToken", token);
  }

  // ── 3. Start launch (creates token info on Bags) ─────────────
  onStep("creating_token");
  const start = await postLaunch({ ...payload, wallet: address }, { authToken: token });

  // Server returns the mint in launch.token_mint; fall back to parsing mintUrl.
  const tokenMintFromLaunch = (start.launch.token_mint as string | undefined) ?? undefined;
  const tokenMintFromUrl = start.bags?.mintUrl?.split("/").pop();
  const tokenMint: string | undefined = tokenMintFromLaunch || tokenMintFromUrl || undefined;

  if (!start.bags) {
    onStep("done", start.message ?? "Saved without Bags integration.");
    return { launchId: start.launch.id, tokenMint };
  }

  let next: string | null = start.bags.nextTransaction;
  if (!next) throw new Error("Bags did not return a transaction to sign.");

  let lastSignature: string | undefined;
  let mintUrl: string | undefined = start.bags.mintUrl;

  // ── 4. Loop sign + submit ────────────────────────────────────
  while (next) {
    onStep("signing_transaction");
    const vtx = VersionedTransaction.deserialize(bs58.decode(next));
    const signedTx = await provider.signTransaction(vtx);
    const signedB58 = bs58.encode(signedTx.serialize());

    onStep("submitting_transaction");
    const step = await submitLaunchSignedTx(start.launch.id, signedB58, { authToken: token });
    lastSignature = step.signature ?? lastSignature;
    mintUrl = step.mintUrl ?? mintUrl;

    if (step.phase === "done") {
      onStep("done");
      return { launchId: start.launch.id, signature: lastSignature, mintUrl, tokenMint };
    }
    next = step.nextTransaction;
    if (!next) throw new Error("Launch flow ended without a final signature.");
  }

  onStep("done");
  return { launchId: start.launch.id, signature: lastSignature, mintUrl, tokenMint };
}

export const stepLabel: Record<LaunchStep, string> = {
  connecting_wallet: "Connecting Phantom…",
  authenticating: "Sign the auth message in Phantom…",
  creating_token: "Creating token metadata on Bags…",
  signing_transaction: "Awaiting Phantom signature…",
  submitting_transaction: "Submitting signed transaction…",
  done: "Done",
};
