/**
 * Create a Solana durable-nonce account funded + authorized by a Fireblocks vault.
 *
 * Flow:
 * 1. Resolve Fireblocks SOL vault address (fee payer + nonce authority)
 * 2. Generate nonce account keypair locally (must sign createAccount)
 * 3. Build SystemProgram.createNonceAccount tx
 * 4. partialSign with nonce account only
 * 5. Fireblocks PROGRAM_CALL signs vault key + broadcasts
 */
import {
    clusterApiUrl,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    NONCE_ACCOUNT_LENGTH,
  } from "@solana/web3.js";
  import fs from "fs";
  import path from "path";
  import {
    FireblocksSDK,
    TransactionStatus,
    PeerType,
    TransactionOperation,
  } from "fireblocks-sdk";
  import { config } from "dotenv";
  
  // Load solana/.env or repo root .env
  config({ path: path.join(__dirname, ".env") });
  config();
  
  /* ---------- Config ---------- */
  const NETWORK = process.env.NETWORK || "devnet"; // "devnet" | "mainnet-beta"
  const VAULT_ACCOUNT_ID = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS || "1";
  const FIREBLOCKS_ASSET_ID = NETWORK === "mainnet" ? "SOL" : "SOL_TEST";
  
  const secretKeyPath =
    process.env.FIREBLOCKS_SECRET_KEY_PATH ||
    path.join(__dirname, "../../credentials/fireblocks_secret.key");
  const secretKey = fs.readFileSync(secretKeyPath, "utf8");
  const apiKey = process.env.FIREBLOCKS_API_KEY || "";
  
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is required");
  }
  
  const fireblocks = new FireblocksSDK(secretKey, apiKey);
  
  const connection = new Connection(
    clusterApiUrl(
      NETWORK === "mainnet-beta" || NETWORK === "mainnet"
        ? "mainnet-beta"
        : "devnet"
    ),
    "confirmed"
  );
  
  /* ---------- Helpers ---------- */
  
  async function waitForTxCompletion(fbTx: { id: string }) {
    let tx: any = await fireblocks.getTransactionById(fbTx.id);
  
    while (tx.status !== TransactionStatus.COMPLETED) {
      if (
        [
          TransactionStatus.BLOCKED,
          TransactionStatus.FAILED,
          TransactionStatus.REJECTED,
          TransactionStatus.CANCELLED,
        ].includes(tx.status)
      ) {
        console.error("Fireblocks tx failed:", JSON.stringify(tx, null, 2));
        throw new Error(`Fireblocks status: ${tx.status}`);
      }
  
      console.log("Fireblocks status:", tx.status);
      await new Promise((r) => setTimeout(r, 4000));
      tx = await fireblocks.getTransactionById(fbTx.id);
    }
  
    return fireblocks.getTransactionById(fbTx.id);
  }
  
  /**
   * Pass partially signed Solana tx as base64 wire format.
   * Fireblocks vault adds its signature and broadcasts.
   */
  async function signAndBroadcastWithFireblocks(
    base64Tx: string,
    note: string
  ) {
    const fbTx = await fireblocks.createTransaction({
      assetId: FIREBLOCKS_ASSET_ID,
      operation: "PROGRAM_CALL" as TransactionOperation,
      source: {
        type: PeerType.VAULT_ACCOUNT,
        id: String(VAULT_ACCOUNT_ID),
      },
      note,
      extraParameters: {
        programCallData: base64Tx,
      },
    });
  
    console.log("Fireblocks tx id:", fbTx.id);
    return waitForTxCompletion(fbTx);
  }
  
  /* ---------- Main ---------- */
  
  async function main() {
    // 1) Fireblocks vault = funding + nonce authority
    const depositAddresses = await fireblocks.getDepositAddresses(
      VAULT_ACCOUNT_ID,
      FIREBLOCKS_ASSET_ID
    );
    if (!depositAddresses?.length) {
      throw new Error(
        `No deposit address for vault ${VAULT_ACCOUNT_ID} / ${FIREBLOCKS_ASSET_ID}`
      );
    }
  
    const fundingAddress = depositAddresses[0].address;
    const fundingPubkey = new PublicKey(fundingAddress);
  
    // 2) New nonce account (local keypair — must sign once)
    const nonceAccount = Keypair.generate();
  
    // 3) Rent-exempt balance
    const rentExempt = await connection.getMinimumBalanceForRentExemption(
      NONCE_ACCOUNT_LENGTH
    );
  
    console.log("Network:          ", NETWORK);
    console.log("Fireblocks asset: ", FIREBLOCKS_ASSET_ID);
    console.log("Vault ID:         ", VAULT_ACCOUNT_ID);
    console.log("Funding (vault):  ", fundingAddress);
    console.log("Nonce account:    ", nonceAccount.publicKey.toBase58());
    console.log("Rent lamports:    ", rentExempt);
  
    const balance = await connection.getBalance(fundingPubkey);
    if (balance < rentExempt + 5000) {
      throw new Error(
        `Insufficient balance: have ${balance}, need ~${rentExempt + 5000} lamports`
      );
    }
  
    // 4) Build createNonceAccount (returns a Transaction)
    const tx = SystemProgram.createNonceAccount({
      fromPubkey: fundingPubkey,
      noncePubkey: nonceAccount.publicKey,
      authorizedPubkey: fundingPubkey, // vault can advance nonce later
      lamports: rentExempt,
    });
  
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = fundingPubkey;
    tx.lastValidBlockHeight = lastValidBlockHeight;
  
    // 5) Only nonce account signs locally — vault signs via Fireblocks
    tx.partialSign(nonceAccount);
  
    const base64Tx = tx
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString("base64");
  
    console.log("Submitting PROGRAM_CALL to Fireblocks...");
  
    // 6) Vault signs + broadcasts
    const completed = await signAndBroadcastWithFireblocks(
      base64Tx,
      `Create Solana nonce account ${nonceAccount.publicKey.toBase58()} on ${NETWORK}`
    );
  
    const txHash = completed.txHash;
    console.log("Tx hash:", txHash);
    console.log(
      "Explorer:",
      `https://explorer.solana.com/tx/${txHash}${
        NETWORK === "devnet" ? "?cluster=devnet" : ""
      }`
    );
    console.log("Nonce account pubkey:", nonceAccount.publicKey.toBase58());
  
    // Optional: wait and read account
    if (txHash) {
      await connection.confirmTransaction(txHash, "confirmed");
    }
  
    const info = await connection.getParsedAccountInfo(nonceAccount.publicKey);
    if (info.value) {
      console.log("Nonce account info:", JSON.stringify(info.value.data, null, 2));
    } else {
      console.log("Account not visible yet — check explorer");
    }
  
    // Use this with Figment durable-nonce stake
    console.log("\n--- save for durable nonce staking ---");
    console.log(`SOL_NONCE_ACCOUNT=${nonceAccount.publicKey.toBase58()}`);
    console.log(`SOL_FUNDING_ACCOUNT=${fundingAddress}`);
    console.log(
      "(nonce secret can be discarded; authority is the Fireblocks vault)"
    );
  }
  
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err?.response?.data || err);
      process.exit(1);
    });