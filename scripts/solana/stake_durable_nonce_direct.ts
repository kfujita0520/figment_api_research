/**
 * Build Solana durable-nonce stake tx WITHOUT Figment.
 * Mirrors scripts/solana/stake_durable_nonce_figment.ts env/funding pattern,
 * but constructs instructions with @solana/web3.js.
 *
 * Flow:
 * 1. Resolve funding from Fireblocks vault deposit address
 * 2. Load on-chain nonce (recentBlockhash = durable nonce value)
 * 3. Build: AdvanceNonce + createStakeAccount + delegate
 * 4. partialSign(stakeAccount only) — vault must sign funding/authority
 * 5. Optionally Fireblocks PROGRAM_CALL (SKIP_FIREBLOCKS=1 to skip)
 *
 * Required env:
 *   FIREBLOCKS_API_KEY             Fireblocks API key
 *   FIREBLOCKS_SECRET_KEY_PATH     path to Fireblocks API user private key PEM
 *   FIREBLOCKS_VAULT_ACCOUNT_IDS   vault id (e.g. "4")
 *   FIREBLOCKS_SOL_NONCE_ACCOUNT   on-chain nonce account pubkey
 *
 * Optional env:
 *   FIREBLOCKS_BASE_URL        default https://api.fireblocks.io
 *   SOL_NONCE_AUTHORITY        defaults to vault funding address
 *   NETWORK                    mainnet | testnet | devnet  (default: devnet)
 *   AMOUNT_SOL                 default: 1.1
 *   VOTE_ACCOUNT               default: Figment devnet vote account
 *   SKIP_FIREBLOCKS            "1" = build payload only (no PROGRAM_CALL)
 */
import {
  Connection,
  Transaction,
  Keypair,
  PublicKey,
  clusterApiUrl,
  NonceAccount,
  SystemProgram,
  StakeProgram,
  Authorized,
  Lockup,
  LAMPORTS_PER_SOL,
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

config({ path: path.join(__dirname, "../../.env") });
config();

const FIREBLOCKS_API_KEY = process.env.FIREBLOCKS_API_KEY || "";
const NETWORK = (process.env.NETWORK || "devnet") as
  | "mainnet"
  | "testnet"
  | "devnet";
const AMOUNT_SOL = Number(process.env.AMOUNT_SOL || "1.1");
const VOTE_ACCOUNT =
  process.env.VOTE_ACCOUNT ||
  "DaRwg7fkGs6Dnbh2cwPwmcsottXCuLBafCAJuQKySZq7";
const NONCE_ACCOUNT = (process.env.FIREBLOCKS_SOL_NONCE_ACCOUNT || "").trim();
const NONCE_AUTHORITY = (process.env.SOL_NONCE_AUTHORITY || "").trim();
const VAULT_ACCOUNT_ID = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS || "";
const FIREBLOCKS_ASSET_ID = NETWORK === "mainnet" ? "SOL" : "SOL_TEST";
const FIREBLOCKS_BASE_URL =
  process.env.FIREBLOCKS_BASE_URL || "https://api.fireblocks.io";
const SKIP_FIREBLOCKS = process.env.SKIP_FIREBLOCKS === "1";
const secretKeyPath =
  process.env.FIREBLOCKS_SECRET_KEY_PATH ||
  path.join(__dirname, "../../credentials/fireblocks_secret.key");

function requireEnv(name: string, value: string) {
  if (!value) throw new Error(`${name} is required`);
}

function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

function createFireblocksClient(): FireblocksSDK {
  requireEnv("FIREBLOCKS_API_KEY", FIREBLOCKS_API_KEY);
  if (!fs.existsSync(secretKeyPath)) {
    throw new Error(`Fireblocks secret key not found: ${secretKeyPath}`);
  }
  const secretKey = fs.readFileSync(secretKeyPath, "utf8");
  return new FireblocksSDK(secretKey, FIREBLOCKS_API_KEY, FIREBLOCKS_BASE_URL);
}

async function resolveFundingFromFireblocksVault(
  fireblocks: FireblocksSDK
): Promise<{
  address: string;
  vaultId: string;
  assetId: string;
}> {
  requireEnv("FIREBLOCKS_VAULT_ACCOUNT_IDS", VAULT_ACCOUNT_ID);
  const deposits = await fireblocks.getDepositAddresses(
    VAULT_ACCOUNT_ID,
    FIREBLOCKS_ASSET_ID
  );
  if (!deposits?.length || !deposits[0].address) {
    throw new Error(
      `No deposit address for vault ${VAULT_ACCOUNT_ID} / ${FIREBLOCKS_ASSET_ID}`
    );
  }
  return {
    address: deposits[0].address,
    vaultId: VAULT_ACCOUNT_ID,
    assetId: FIREBLOCKS_ASSET_ID,
  };
}

async function waitForTransactionCompletion(
  fireblocks: FireblocksSDK,
  fbTx: { id: string }
) {
  let current = await fireblocks.getTransactionById(fbTx.id);
  while (current.status !== TransactionStatus.COMPLETED) {
    if (
      [
        TransactionStatus.BLOCKED,
        TransactionStatus.FAILED,
        TransactionStatus.REJECTED,
        TransactionStatus.CANCELLED,
      ].includes(current.status)
    ) {
      console.error(
        "Fireblocks transaction failed:",
        JSON.stringify(current, null, 2)
      );
      throw new Error(
        `Fireblocks transaction status: ${current.status} ${
          current.subStatus || ""
        }`
      );
    }
    console.log(
      "Waiting for Fireblocks status:",
      current.status,
      current.subStatus || ""
    );
    await new Promise((r) => setTimeout(r, 4000));
    current = await fireblocks.getTransactionById(fbTx.id);
  }
  return fireblocks.getTransactionById(fbTx.id);
}

async function signAndBroadcastWithFireblocks(
  fireblocks: FireblocksSDK,
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
      // Figment (or this script) already embeds durable nonce; do not wrap again
      useDurableNonce: false,
    },
  });

  console.log("Fireblocks transaction created:", fbTx.id);
  const completed = await waitForTransactionCompletion(fireblocks, fbTx);
  return completed;
}

/**
 * Durable-nonce stake message (first ix must be AdvanceNonce).
 * Returns partial-signed wire (stake account only).
 */
async function buildDurableNonceStakeTx(params: {
  connection: Connection;
  funding: PublicKey;
  authority: PublicKey;
  nonceAccount: PublicKey;
  voteAccount: PublicKey;
  amountSol: number;
}) {
  const {
    connection,
    funding,
    authority,
    nonceAccount,
    voteAccount,
    amountSol,
  } = params;

  const nonceInfo = await connection.getAccountInfo(nonceAccount);
  if (!nonceInfo) {
    throw new Error(`Nonce account missing: ${nonceAccount.toBase58()}`);
  }
  const na = NonceAccount.fromAccountData(nonceInfo.data);
  if (!na.authorizedPubkey.equals(authority)) {
    throw new Error(
      `Nonce authority mismatch: on-chain=${na.authorizedPubkey.toBase58()} expected=${authority.toBase58()}`
    );
  }

  const stakeAccount = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(
    StakeProgram.space
  );
  const lamports = rent + solToLamports(amountSol);

  // Instruction 0 MUST be AdvanceNonce for durable nonce semantics
  const advanceIx = SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount,
    authorizedPubkey: authority,
  });

  const createAccountTx = StakeProgram.createAccount({
    fromPubkey: funding,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(funding, funding),
    lockup: new Lockup(0, 0, PublicKey.default),
    lamports,
  });

  const delegateTx = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: funding,
    votePubkey: voteAccount,
  });

  const tx = new Transaction();
  tx.add(advanceIx);
  createAccountTx.instructions.forEach((ix) => tx.add(ix));
  delegateTx.instructions.forEach((ix) => tx.add(ix));

  tx.feePayer = funding;
  tx.recentBlockhash = na.nonce; // durable nonce value, not recent blockhash

  // Only stake account signs locally; vault signs fee payer + nonce authority
  tx.partialSign(stakeAccount);

  const wire = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    stakeAccount: stakeAccount.publicKey.toBase58(),
    durableNonce: na.nonce,
    isDurableNonce: true,
    lamports,
    rent,
    unsignedTxHex: wire.toString("hex"),
    unsignedTxBase64: wire.toString("base64"),
    transaction: tx,
  };
}

function printSigners(tx: Transaction) {
  console.log("\nRequired signers:");
  tx.signatures.forEach((s, i) => {
    console.log(
      `  ${i + 1}. ${s.publicKey.toBase58()} → ${
        s.signature ? "pre-signed" : "MISSING"
      }`
    );
  });
}

function printInstructions(tx: Transaction) {
  console.log("\n========== Instructions ==========");
  tx.instructions.forEach((ix, i) => {
    console.log(`\n--- Instruction [${i}] ---`);
    console.log("  programId:", ix.programId.toBase58());
    console.log("  data (hex):", Buffer.from(ix.data).toString("hex"));
    ix.keys.forEach((k, j) => {
      console.log(
        `  [${j}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${
          k.isWritable
        }`
      );
    });
  });
}

async function main() {
  requireEnv("FIREBLOCKS_SOL_NONCE_ACCOUNT", NONCE_ACCOUNT);
  // if (AMOUNT_SOL < 1.1) {
  //   // Figment min is 1.1; native stake can be lower — keep or relax
  //   console.warn("AMOUNT_SOL < 1.1 (ok for native stake; Figment min is 1.1)");
  // }

  const fireblocks = createFireblocksClient();
  const { address: fundingAddress, vaultId, assetId } =
    await resolveFundingFromFireblocksVault(fireblocks);
  const funding = new PublicKey(fundingAddress);
  const authority = NONCE_AUTHORITY
    ? new PublicKey(NONCE_AUTHORITY)
    : funding;
  const nonceAccount = new PublicKey(NONCE_ACCOUNT);
  const voteAccount = new PublicKey(VOTE_ACCOUNT);

  const cluster =
    NETWORK === "mainnet" ? "mainnet-beta" : (NETWORK as "devnet" | "testnet");
  const connection = new Connection(clusterApiUrl(cluster), "confirmed");

  console.log("Network:         ", NETWORK);
  console.log("Fireblocks vault:", vaultId, `(${assetId})`);
  console.log("Funding (vault): ", funding.toBase58());
  console.log("Nonce account:   ", nonceAccount.toBase58());
  console.log("Nonce authority: ", authority.toBase58());
  console.log("Vote account:    ", voteAccount.toBase58());
  console.log("Amount SOL:      ", AMOUNT_SOL);

  const payload = await buildDurableNonceStakeTx({
    connection,
    funding,
    authority,
    nonceAccount,
    voteAccount,
    amountSol: AMOUNT_SOL,
  });

  console.log("\n--- Built payload (no Figment) ---");
  console.log("stake_account:   ", payload.stakeAccount);
  console.log("is_durable_nonce:", payload.isDurableNonce);
  console.log("nonce_value:     ", payload.durableNonce);
  console.log("lamports:        ", payload.lamports, `(rent ${payload.rent})`);
  console.log("HEX length:      ", payload.unsignedTxHex.length);
  console.log("BASE64 length:   ", payload.unsignedTxBase64.length);
  console.log("\nBASE64 (Fireblocks programCallData):");
  console.log(payload.unsignedTxBase64);

  printSigners(payload.transaction);
  printInstructions(payload.transaction);

  if (SKIP_FIREBLOCKS) {
    console.log("\nSKIP_FIREBLOCKS=1 — not submitting PROGRAM_CALL");
    return;
  }

  console.log(
    "\nSubmitting Fireblocks PROGRAM_CALL (useDurableNonce=false)..."
  );
  const completed = await signAndBroadcastWithFireblocks(
    fireblocks,
    payload.unsignedTxBase64,
    `Native durable-nonce stake account=${payload.stakeAccount} amount=${AMOUNT_SOL}`
  );
  console.log("Fireblocks id:", completed.id);
  console.log("status:", completed.status, completed.subStatus);
  console.log("txHash:", completed.txHash);
}

function amountSolValid(sol: number): boolean {
  return Number.isFinite(sol) && sol > 0;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.response?.data || e);
    process.exit(1);
  });
