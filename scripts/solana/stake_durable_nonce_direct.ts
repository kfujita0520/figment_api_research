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
 * 5. Fireblocks PROGRAM_CALL with signOnly=true (no Fireblocks broadcast)
 * 6. Extract signedProgramCallData and sendRawTransaction yourself
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
 *   SKIP_BROADCAST             "1" = sign only (no sendRawTransaction)
 *   SKIP_SIMULATE              "1" = skip preflight simulate before broadcast
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
  SendTransactionError,
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
const SKIP_BROADCAST = process.env.SKIP_BROADCAST === "1";
const SKIP_SIMULATE = process.env.SKIP_SIMULATE === "1";
const secretKeyPath =
  process.env.FIREBLOCKS_SECRET_KEY_PATH ||
  path.join(__dirname, "../../credentials/fireblocks_secret.key");

/** Docs use SIGNED; older fireblocks-sdk typings may omit it. */
const FB_SIGNED = "SIGNED";

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

/**
 * Wait until Fireblocks finishes vault signing (signOnly → SIGNED).
 * COMPLETED is accepted too (workspace/policy variants).
 */
async function waitForFireblocksSigned(
  fireblocks: FireblocksSDK,
  fbTx: { id: string }
) {
  const terminalFail = new Set([
    TransactionStatus.BLOCKED,
    TransactionStatus.FAILED,
    TransactionStatus.REJECTED,
    TransactionStatus.CANCELLED,
    "DROPPED",
  ]);
  const terminalOk = new Set([
    FB_SIGNED,
    TransactionStatus.COMPLETED,
    TransactionStatus.CONFIRMED,
  ]);

  let current: any = await fireblocks.getTransactionById(fbTx.id);
  while (!terminalOk.has(current.status)) {
    if (terminalFail.has(current.status)) {
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
      "Waiting for Fireblocks sign:",
      current.status,
      current.subStatus || ""
    );
    await new Promise((r) => setTimeout(r, 4000));
    current = await fireblocks.getTransactionById(fbTx.id);
  }
  return fireblocks.getTransactionById(fbTx.id);
}

/**
 * Extract base64 signed wire after PROGRAM_CALL + signOnly.
 * Primary field (docs / multi-vault): signedProgramCallData
 */
function extractSignedProgramCallData(fbTx: any): string {
  const candidates = [
    fbTx?.signedProgramCallData,
    fbTx?.signed_program_call_data,
    fbTx?.extraParameters?.signedProgramCallData,
    fbTx?.extraParameters?.signed_program_call_data,
    // Some workspaces return the updated payload in the same field
    fbTx?.extraParameters?.programCallData,
  ].filter((v) => typeof v === "string" && v.length > 0);

  if (!candidates.length) {
    console.error(
      "Could not find signedProgramCallData. Full Fireblocks tx keys/response:"
    );
    console.error(JSON.stringify(fbTx, null, 2));
    throw new Error(
      "Expected signedProgramCallData after SIGNED status (see Fireblocks response dump above)"
    );
  }

  return String(candidates[0]).replace(/\s/g, "");
}

/**
 * Fireblocks PROGRAM_CALL with signOnly — vault signs only, no FB broadcast.
 * Docs: https://developers.fireblocks.com/reference/interact-with-solana-programs
 */
async function signWithFireblocks(
  fireblocks: FireblocksSDK,
  base64Tx: string,
  note: string
): Promise<{ fbTx: any; signedBase64: string }> {
  const created = await fireblocks.createTransaction({
    assetId: FIREBLOCKS_ASSET_ID,
    operation: "PROGRAM_CALL" as TransactionOperation,
    source: {
      type: PeerType.VAULT_ACCOUNT,
      id: String(VAULT_ACCOUNT_ID),
    },
    note,
    extraParameters: {
      programCallData: base64Tx,
      // Payload already embeds durable nonce AdvanceNonce
      useDurableNonce: false,
      signOnly: true,
    },
  });

  console.log("Fireblocks signOnly PROGRAM_CALL created:", created.id);
  const signedTx = await waitForFireblocksSigned(fireblocks, created);
  console.log(
    "Fireblocks sign status:",
    signedTx.status,
    signedTx.subStatus || ""
  );

  const signedBase64 = extractSignedProgramCallData(signedTx);
  return { fbTx: signedTx, signedBase64 };
}

async function simulateSignedTx(
  connection: Connection,
  signedBase64: string
): Promise<void> {
  const tx = Transaction.from(Buffer.from(signedBase64, "base64"));
  const sim = await connection.simulateTransaction(tx);
  console.log("\n--- simulateTransaction ---");
  console.log("err: ", sim.value.err);
  console.log("unitsConsumed:", sim.value.unitsConsumed);
  if (sim.value.logs?.length) {
    console.log("logs (last 20):");
    sim.value.logs.slice(-20).forEach((l) => console.log(" ", l));
  }
  if (sim.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)} — not broadcasting`
    );
  }
}

async function broadcastSignedTx(
  connection: Connection,
  signedBase64: string,
  durableConfirm: {
    nonceAccount: PublicKey;
    nonceValue: string;
  }
): Promise<string> {
  const raw = Buffer.from(signedBase64, "base64");
  try {
    // Slot bound for durable-nonce confirmation strategy (non-deprecated API)
    const minContextSlot = await connection.getSlot("confirmed");
    const sig = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
      minContextSlot,
    });
    console.log("Submitted signature:", sig);
    const conf = await connection.confirmTransaction(
      {
        signature: sig,
        minContextSlot,
        nonceAccountPubkey: durableConfirm.nonceAccount,
        nonceValue: durableConfirm.nonceValue,
      },
      "confirmed"
    );
    if (conf.value.err) {
      throw new Error(
        `Transaction confirmed with error: ${JSON.stringify(conf.value.err)}`
      );
    }
    return sig;
  } catch (e) {
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs(connection).catch(() => null);
      console.error("SendTransactionError:", e.message);
      if (logs) console.error("logs:", logs);
    }
    throw e;
  }
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
  if (!(Number.isFinite(AMOUNT_SOL) && AMOUNT_SOL > 0)) {
    throw new Error(`Invalid AMOUNT_SOL: ${AMOUNT_SOL}`);
  }

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
  console.log("Mode:            PROGRAM_CALL + signOnly → self broadcast");

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
  console.log("\nBASE64 (partial-signed programCallData):");
  console.log(payload.unsignedTxBase64);

  printSigners(payload.transaction);
  printInstructions(payload.transaction);

  if (SKIP_FIREBLOCKS) {
    console.log("\nSKIP_FIREBLOCKS=1 — not submitting PROGRAM_CALL");
    return;
  }

  console.log(
    "\nSubmitting Fireblocks PROGRAM_CALL (signOnly=true, useDurableNonce=false)..."
  );
  const { fbTx, signedBase64 } = await signWithFireblocks(
    fireblocks,
    payload.unsignedTxBase64,
    `Native durable-nonce stake (signOnly) account=${payload.stakeAccount} amount=${AMOUNT_SOL}`
  );
  console.log("Fireblocks id:", fbTx.id);
  console.log("Signed BASE64 length:", signedBase64.length);
  console.log("\nBASE64 (signed programCallData — for sendRawTransaction):");
  console.log(signedBase64);

  if (SKIP_BROADCAST) {
    console.log("\nSKIP_BROADCAST=1 — signed only, not broadcasting");
    return;
  }

  if (!SKIP_SIMULATE) {
    await simulateSignedTx(connection, signedBase64);
  }

  console.log("\nBroadcasting via RPC sendRawTransaction...");
  const signature = await broadcastSignedTx(connection, signedBase64, {
    nonceAccount,
    nonceValue: payload.durableNonce,
  });
  console.log("\nOn-chain signature:", signature);
  console.log(
    "Explorer:",
    NETWORK === "mainnet"
      ? `https://solscan.io/tx/${signature}`
      : `https://solscan.io/tx/${signature}?cluster=${NETWORK}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.response?.data || e);
    process.exit(1);
  });
