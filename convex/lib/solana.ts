/**
 * Solana RPC and transfer helpers.
 * Pure functions — no convex exports.
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getSolRpcUrl, solLamportsToFundingCents, LAMPORTS_PER_SOL } from "./paymentsUtils";

export type InboundSolanaFundingTx = {
  txSig: string;
  walletAddress: string;
  lamports: number;
  amountSol: number;
  amountCents: number;
  slot: number | null;
  blockTime: number | null;
};

export function toAccountKeyString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const maybe = value as { pubkey?: unknown; toBase58?: (() => string) | undefined };
    if (typeof maybe.pubkey === "string") return maybe.pubkey;
    if (typeof maybe.pubkey === "object" && maybe.pubkey !== null) {
      const withBase58 = maybe.pubkey as { toBase58?: (() => string) | undefined };
      if (typeof withBase58.toBase58 === "function") return withBase58.toBase58();
    }
    if (typeof maybe.toBase58 === "function") return maybe.toBase58();
  }
  return null;
}

export async function rpcCall(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`solana_rpc_http_${res.status}`);
  const json = (await res.json()) as any;
  if (json?.error) throw new Error(`solana_rpc_error_${json.error?.message ?? "unknown"}`);
  return json?.result ?? null;
}

export async function scanInboundSolanaFundingTxs(params: {
  walletAddresses: Array<string>;
  maxTx: number;
}): Promise<Array<InboundSolanaFundingTx>> {
  if (params.walletAddresses.length === 0) return [];
  const rpcUrl = getSolRpcUrl();
  const walletSet = new Set(params.walletAddresses);
  const sigMeta = new Map<string, { slot: number | null; blockTime: number | null }>();

  for (const address of walletSet) {
    try {
      const sigs = (await rpcCall(rpcUrl, "getSignaturesForAddress", [
        address,
        { limit: params.maxTx },
      ])) as Array<any>;
      for (const row of sigs ?? []) {
        if (row?.err != null) continue;
        const signature = typeof row?.signature === "string" ? row.signature : null;
        if (!signature) continue;
        sigMeta.set(signature, {
          slot: typeof row?.slot === "number" ? row.slot : null,
          blockTime: typeof row?.blockTime === "number" ? row.blockTime : null,
        });
      }
    } catch {
      continue;
    }
  }

  const out: Array<InboundSolanaFundingTx> = [];
  for (const [signature, info] of sigMeta.entries()) {
    let tx: any = null;
    try {
      tx = await rpcCall(rpcUrl, "getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
    } catch {
      continue;
    }
    if (!tx || !tx.meta || tx.meta.err != null) continue;
    const accountKeys = (tx?.transaction?.message?.accountKeys ?? []) as Array<unknown>;
    const preBalances = (tx?.meta?.preBalances ?? []) as Array<number>;
    const postBalances = (tx?.meta?.postBalances ?? []) as Array<number>;

    let netInboundLamports = 0;
    let topInboundAddress: string | null = null;
    let topInboundLamports = 0;
    for (let idx = 0; idx < accountKeys.length; idx += 1) {
      const key = toAccountKeyString(accountKeys[idx]);
      if (key === null || !walletSet.has(key)) continue;
      const delta = (postBalances[idx] ?? 0) - (preBalances[idx] ?? 0);
      netInboundLamports += delta;
      if (delta > topInboundLamports) {
        topInboundLamports = delta;
        topInboundAddress = key;
      }
    }
    if (netInboundLamports <= 0 || topInboundAddress === null) continue;
    out.push({
      txSig: signature,
      walletAddress: topInboundAddress,
      lamports: netInboundLamports,
      amountSol: netInboundLamports / LAMPORTS_PER_SOL,
      amountCents: solLamportsToFundingCents(netInboundLamports),
      slot: typeof tx?.slot === "number" ? tx.slot : info.slot,
      blockTime: typeof tx?.blockTime === "number" ? tx.blockTime : info.blockTime,
    });
  }

  out.sort((a, b) => {
    const aTime = a.blockTime ?? 0;
    const bTime = b.blockTime ?? 0;
    if (aTime !== bTime) return bTime - aTime;
    const aSlot = a.slot ?? 0;
    const bSlot = b.slot ?? 0;
    return bSlot - aSlot;
  });
  return out;
}

export function parseBitrefillInvoice(output: unknown): { address: string; amountSol: number } | null {
  if (typeof output !== "string") return null;
  const addr = output.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  const amt = output.match(/([0-9]+(?:\.[0-9]+)?)\s*(SOL|solana)/i);
  if (!addr || !amt) return null;
  const amount = Number(amt[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { address: addr[0], amountSol: amount };
}

export async function sendSolTransfer(params: { secretHex: string; toAddress: string; amountSol: number }): Promise<{ ok: boolean; txSig?: string; error?: string }> {
  try {
    const bytes = new Uint8Array((params.secretHex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
    const kp = Keypair.fromSecretKey(bytes);
    const conn = new Connection(getSolRpcUrl(), "confirmed");
    const to = new PublicKey(params.toAddress);
    const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports }),
    );
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    return { ok: true, txSig: sig };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sol_transfer_failed" };
  }
}
