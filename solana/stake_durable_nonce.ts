/**
 * Hot-wallet Figment stake with durable nonce.
 * Prerequisite: create nonce via solana/create_nonce_account.ts
 *
 * Env:
 *   API_KEY
 *   SOL_PRIVATE_KEY          funding + nonce authority secret (base58)
 *   SOL_NONCE_ACCOUNT        required
 *   SOL_NONCE_AUTHORITY      optional (default: wallet)
 *   FUNDING_ACCOUNT          optional (default: wallet pubkey)
 *   NETWORK                  default devnet
 *   AMOUNT_SOL               default 1.1
 *   VOTE_ACCOUNT             default Figment devnet vote
 *   BROADCAST                "1" to broadcast after sign
 */
import {
    Transaction,
    Keypair,
    PublicKey,
    Connection,
    clusterApiUrl,
    NonceAccount,
  } from "@solana/web3.js";
  import bs58 from "bs58";
  import nacl from "tweetnacl";
  import axios from "axios";
  import { config } from "dotenv";
  config();
  
  const API_KEY = process.env.API_KEY || "";
  const NETWORK = (process.env.NETWORK || "devnet") as
    | "mainnet"
    | "testnet"
    | "devnet";
  const AMOUNT_SOL = Number(process.env.AMOUNT_SOL || "1.1");
  const VOTE_ACCOUNT =
    process.env.VOTE_ACCOUNT ||
    "DaRwg7fkGs6Dnbh2cwPwmcsottXCuLBafCAJuQKySZq7";
  const NONCE_ACCOUNT = process.env.SOL_NONCE_ACCOUNT || "";
  const NONCE_AUTHORITY_ENV = process.env.SOL_NONCE_AUTHORITY || "";
  const DO_BROADCAST = true;
  
  function requireEnv(name: string, v: string) {
    if (!v) throw new Error(`${name} is required`);
  }
  
  async function generateStakePayload(body: Record<string, unknown>) {
    const { data } = await axios.post(
      "https://api.figment.io/solana/stake",
      body,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
      }
    );
    return data?.data ?? data;
  }
  
  /**
   * Figment Get Solana Activity (UUID or tx hash).
   * Docs: https://docs.figment.io/reference/get-solana-activity
   */
  async function getActivityByTxHash(txHash: string) {
    const { data } = await axios.get(
      `https://api.figment.io/solana/activities/${txHash}`,
      {
        params: { network: NETWORK },
        headers: {
          Accept: "application/json",
          "x-api-key": API_KEY,
        },
      }
    );
    return data?.data ?? data;
  }

  async function broadcast(transaction_payload: string) {
    const { data } = await axios.post(
      "https://api.figment.io/solana/broadcast",
      { network: NETWORK, transaction_payload },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
      }
    );
    return data?.data ?? data;
  }

  async function broadcastAndWaitForCompletion(
    transactionPayload: string,
    maxRetries = 30,
    retryDelay = 2000
  ) {
    console.log("Broadcasting...");
    const broadcastResult = await broadcast(transactionPayload);
    const txHash =
      broadcastResult.transaction_hash || broadcastResult.tx_hash;
    if (!txHash) throw new Error("No transaction_hash from broadcast");

    console.log("Tx hash:", txHash);
    const explorerQs =
      NETWORK === "mainnet"
        ? ""
        : "?cluster=devnet";
    console.log(
      "Explorer:",
      `https://explorer.solana.com/tx/${txHash}${explorerQs}`
    );

    for (let attempts = 1; attempts <= maxRetries; attempts++) {
      try {
        const activity = await getActivityByTxHash(txHash);
        // activity-life: pending | complete | failed
        // on-chain tx: in_progress | confirmed | failed | expired
        const activityStatus = activity?.status;
        const txStatus = activity?.tx?.status;

        console.log(
          `Status (${attempts}/${maxRetries}): activity=${activityStatus} tx=${txStatus}`
        );

        if (txStatus === "confirmed") {
          console.log("On-chain tx confirmed.");
          return { txHash, status: activity, success: true };
        }
        if (txStatus === "failed" || txStatus === "expired") {
          console.log("On-chain tx failed/expired.");
          return { txHash, status: activity, success: false };
        }
        if (activityStatus === "failed") {
          return { txHash, status: activity, success: false };
        }
      } catch (e: any) {
        // Activity may not be indexed immediately after broadcast
        console.log(
          `Status check failed (${attempts}/${maxRetries}):`,
          e?.response?.data || e.message
        );
      }
      await new Promise((r) => setTimeout(r, retryDelay));
    }

    return {
      txHash,
      status: { status: "timeout" },
      success: false,
    };
  }
  
  async function signTransaction(
    unsignedTransactionHex: string,
    wallet: Keypair
  ): Promise<string | undefined> {
    const transaction = Transaction.from(
      Buffer.from(unsignedTransactionHex, "hex")
    );
    transaction.partialSign(wallet);
  
    console.log("Required signers:");
    transaction.signatures.forEach((sig, i) => {
      console.log(
        `  ${i + 1}. ${sig.publicKey.toBase58()} → ${
          sig.signature ? "Signed" : "Missing"
        }`
      );
    });
  
    const missing = transaction.signatures.filter((s) => !s.signature);
    if (missing.length > 0) {
      console.log(
        "Missing:",
        missing.map((s) => s.publicKey.toBase58())
      );
      return undefined;
    }
  
    transaction.signatures.forEach((sig, i) => {
      if (!sig.signature) return;
      const ok = nacl.sign.detached.verify(
        transaction.serializeMessage(),
        sig.signature,
        sig.publicKey.toBytes()
      );
      console.log(`Signature ${i + 1} nacl verify:`, ok);
    });
  
    return transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("hex");
  }
  
  async function main() {
    requireEnv("API_KEY", API_KEY);
    requireEnv("SOL_NONCE_ACCOUNT", NONCE_ACCOUNT);
  
    const privateKey = process.env.SOL_PRIVATE_KEY || "";
    requireEnv("SOL_PRIVATE_KEY", privateKey);
    const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  
    const fundingAccount =
      process.env.FUNDING_ACCOUNT || wallet.publicKey.toBase58();
    const nonceAuthority =
      NONCE_AUTHORITY_ENV || wallet.publicKey.toBase58();
  
    if (fundingAccount !== wallet.publicKey.toBase58()) {
      throw new Error(
        `FUNDING_ACCOUNT ${fundingAccount} != wallet ${wallet.publicKey.toBase58()}`
      );
    }
    if (nonceAuthority !== wallet.publicKey.toBase58()) {
      throw new Error(
        `SOL_NONCE_AUTHORITY ${nonceAuthority} != wallet (must sign advance+funding)`
      );
    }
    if (AMOUNT_SOL < 1.1) {
      throw new Error("AMOUNT_SOL must be >= 1.1");
    }
  
    // On-chain nonce check
    const cluster =
      NETWORK === "mainnet" ? "mainnet-beta" : (NETWORK as "devnet" | "testnet");
    const connection = new Connection(clusterApiUrl(cluster), "confirmed");
    const noncePk = new PublicKey(NONCE_ACCOUNT);
    const ai = await connection.getAccountInfo(noncePk);
    if (!ai) throw new Error(`Nonce account not found: ${NONCE_ACCOUNT}`);
    const na = NonceAccount.fromAccountData(ai.data);
    console.log("On-chain nonce authority:", na.authorizedPubkey.toBase58());
    console.log("On-chain durable nonce:  ", na.nonce);
    if (!na.authorizedPubkey.equals(wallet.publicKey)) {
      throw new Error(
        `On-chain authority ${na.authorizedPubkey.toBase58()} != wallet`
      );
    }
  
    const requestBody = {
      network: NETWORK,
      amount_sol: AMOUNT_SOL,
      vote_account: VOTE_ACCOUNT,
      funding_account: fundingAccount,
      nonce_account: NONCE_ACCOUNT,
      nonce_authority: nonceAuthority,
    };
    console.log("POST body:", JSON.stringify(requestBody, null, 2));
  
    const stake = await generateStakePayload(requestBody);
    console.log("stake_account:", stake.stake_account);
    console.log("is_durable_nonce:", stake.is_durable_nonce);
    console.log("nonce_value:", stake.nonce_value);
  
    const unsignedHex =
      stake.unsigned_tx_serialized_hex ||
      stake.unsigned_transaction_serialized;
    if (!unsignedHex) throw new Error("No unsigned hex from Figment");
  
    const fullySignedHex = await signTransaction(unsignedHex, wallet);
    if (!fullySignedHex) {
      throw new Error("Signing incomplete");
    }
    console.log("Fully signed hex length:", fullySignedHex.length);
  
    if (DO_BROADCAST) {
      const result = await broadcastAndWaitForCompletion(fullySignedHex);
      console.log("Broadcast result:", result);
    } else {
      console.log('Set BROADCAST=1 to submit via Figment broadcast API');
    }
  }
  
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e?.response?.data || e);
      process.exit(1);
    });