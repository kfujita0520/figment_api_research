/**
 * Figment Solana durable-nonce stake + Fireblocks PROGRAM_CALL sign/broadcast.
 * Docs: https://docs.figment.io/reference/solana-stake
 *
 * Flow:
 * 1. Resolve funding from Fireblocks vault deposit address
 * 2. Create stake tx via Figment (with nonce_account)
 * 3. Fireblocks PROGRAM_CALL signs vault + broadcasts
 *
 * Required env:
 *   FIREBLOCKS_API_KEY             Fireblocks API key
 *   FIREBLOCKS_SECRET_KEY_PATH     path to Fireblocks API user private key PEM
 *   FIREBLOCKS_VAULT_ACCOUNT_IDS   vault id (e.g. "4")
 *   FIREBLOCKS_SOL_NONCE_ACCOUNT   on-chain nonce account pubkey
 *   API_KEY                        Figment API key (x-api-key)
 *
 * Optional env:
 *   FIREBLOCKS_BASE_URL        default https://api.fireblocks.io
 *   SOL_NONCE_AUTHORITY        defaults to vault funding address
 *   NETWORK                    mainnet | testnet | devnet  (default: devnet)
 *   AMOUNT_SOL                 min 1.1 (default: 1.1)
 *   VOTE_ACCOUNT               default: Figment devnet vote account
 */
import {
  Connection,
  Transaction,
  PublicKey,
  clusterApiUrl,
  NonceAccount,
  SystemProgram,
  StakeProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import axios from "axios";
import fs from "fs";
import {
  FireblocksSDK,
  TransactionStatus,
  PeerType,
  TransactionOperation,
} from "fireblocks-sdk";
import { config } from "dotenv";

config();

const FIGMENT_STAKE_URL = "https://api.figment.io/solana/stake";

const FIREBLOCKS_API_KEY = process.env.FIREBLOCKS_API_KEY || "";
const FIGMENT_API_KEY = process.env.API_KEY || "";
const NETWORK = (process.env.NETWORK || "devnet") as
  | "mainnet"
  | "testnet"
  | "devnet";
const AMOUNT_SOL = Number(process.env.AMOUNT_SOL || "1.1");
const VOTE_ACCOUNT =
  process.env.VOTE_ACCOUNT ||
  "DaRwg7fkGs6Dnbh2cwPwmcsottXCuLBafCAJuQKySZq7";
const NONCE_ACCOUNT = process.env.FIREBLOCKS_SOL_NONCE_ACCOUNT || "";
const NONCE_AUTHORITY = process.env.SOL_NONCE_AUTHORITY || "";
const VAULT_ACCOUNT_ID = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS || "";
const FIREBLOCKS_ASSET_ID =
  NETWORK === "mainnet" ? "SOL" : "SOL_TEST";
const FIREBLOCKS_BASE_URL =
  process.env.FIREBLOCKS_BASE_URL || "https://api.fireblocks.io";
const secretKeyPath =
  process.env.FIREBLOCKS_SECRET_KEY_PATH;

function requireEnv(name: string, value: string) {
  if (!value) throw new Error(`${name} is required`);
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

async function createStakeTx(body: Record<string, unknown>) {
  const { data } = await axios.post(FIGMENT_STAKE_URL, body, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": FIGMENT_API_KEY,
    },
  });
  return data?.data ?? data;
}

async function waitForTxCompletion(
  fireblocks: FireblocksSDK,
  fbTx: { id: string }
) {
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
      throw new Error(
        `Fireblocks status: ${tx.status} ${tx.subStatus || ""}`.trim()
      );
    }

    console.log("Fireblocks status:", tx.status, tx.subStatus || "");
    await new Promise((r) => setTimeout(r, 4000));
    tx = await fireblocks.getTransactionById(fbTx.id);
  }

  return fireblocks.getTransactionById(fbTx.id);
}

/**
 * Sign vault remaining slots and broadcast via Fireblocks PROGRAM_CALL.
 * Accepts Figment unsigned_transaction_serialized (hex); converts to base64 for programCallData.
 * useDurableNonce:false — Figment payload already embeds durable nonce.
 */
async function signAndBroadcastWithFireblocks(
  fireblocks: FireblocksSDK,
  unsignedHex: string,
  note: string
) {
  const programCallData = unsignedHexToProgramCallBase64(unsignedHex);
  console.log("\nprogramCallData (base64) length:", programCallData.length);
  console.log(
    "\nSubmitting Fireblocks PROGRAM_CALL (useDurableNonce=false)..."
  );

  const fbTx = await fireblocks.createTransaction({
    assetId: FIREBLOCKS_ASSET_ID,
    operation: "PROGRAM_CALL" as TransactionOperation,
    source: {
      type: PeerType.VAULT_ACCOUNT,
      id: String(VAULT_ACCOUNT_ID),
    },
    note,
    extraParameters: {
      programCallData,
      useDurableNonce: false,
    },
  });

  console.log("Fireblocks tx id:", fbTx.id);
  return waitForTxCompletion(fireblocks, fbTx);
}

/**
 * Figment Stake returns unsigned_transaction_serialized (hex wire).
 * Fireblocks programCallData expects base64.
 */
function unsignedHexToProgramCallBase64(hex: string): string {
  const cleaned = String(hex).replace(/\s/g, "");
  const tx = Transaction.from(Buffer.from(cleaned, "hex"));
  return tx
    .serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
    .toString("base64");
}

async function verifyNonceOnChain(
  connection: Connection,
  noncePubkey: PublicKey,
  expectedAuthority?: PublicKey
) {
  const info = await connection.getAccountInfo(noncePubkey);
  if (!info) {
    throw new Error(
      `Nonce account ${noncePubkey.toBase58()} does not exist on ${NETWORK}`
    );
  }
  const na = NonceAccount.fromAccountData(info.data);
  console.log("On-chain nonce:");
  console.log("  authority:", na.authorizedPubkey.toBase58());
  console.log("  durable nonce value:", na.nonce);
  if (
    expectedAuthority &&
    !na.authorizedPubkey.equals(expectedAuthority)
  ) {
    throw new Error(
      `Nonce authority mismatch: on-chain=${na.authorizedPubkey.toBase58()} expected=${expectedAuthority.toBase58()}`
    );
  }
  return na;
}

const KNOWN_PROGRAMS: Record<string, string> = {
  [SystemProgram.programId.toBase58()]: "System Program",
  [StakeProgram.programId.toBase58()]: "Stake Program",
  [ComputeBudgetProgram.programId.toBase58()]: "Compute Budget Program",
  ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"]: "Memo",
  ["Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]: "Memo (legacy)",
};

function systemIxName(data: Buffer): string {
  if (data.length < 4) return `System(unknown, len=${data.length})`;
  const ix = data.readUInt32LE(0);
  const names: Record<number, string> = {
    0: "CreateAccount",
    1: "Assign",
    2: "Transfer",
    3: "CreateAccountWithSeed",
    4: "AdvanceNonceAccount",
    5: "WithdrawNonceAccount",
    6: "InitializeNonceAccount",
    7: "AuthorizeNonceAccount",
  };
  return names[ix] || `System(ix=${ix})`;
}

function stakeIxName(data: Buffer): string {
  if (data.length < 4) return `Stake(unknown, len=${data.length})`;
  const ix = data.readUInt32LE(0);
  const names: Record<number, string> = {
    0: "Initialize",
    1: "Authorize",
    2: "DelegateStake",
    3: "Split",
    4: "Withdraw",
    5: "Deactivate",
    6: "SetLockup",
    7: "Merge",
    8: "AuthorizeWithSeed",
    9: "InitializeChecked",
    10: "AuthorizeChecked",
    11: "AuthorizeCheckedWithSeed",
    12: "SetLockupChecked",
  };
  return names[ix] || `Stake(ix=${ix})`;
}

function computeBudgetIxName(data: Buffer): string {
  if (data.length < 1) return "ComputeBudget(empty)";
  const tag = data[0];
  const names: Record<number, string> = {
    0: "RequestUnitsDeprecated",
    1: "RequestHeapFrame",
    2: "SetComputeUnitLimit",
    3: "SetComputeUnitPrice",
    4: "SetLoadedAccountsDataSizeLimit",
  };
  return names[tag] || `ComputeBudget(tag=${tag})`;
}

function decodeInstructionName(programId: PublicKey, data: Buffer): string {
  const id = programId.toBase58();
  if (id === SystemProgram.programId.toBase58()) return systemIxName(data);
  if (id === StakeProgram.programId.toBase58()) return stakeIxName(data);
  if (id === ComputeBudgetProgram.programId.toBase58())
    return computeBudgetIxName(data);
  return KNOWN_PROGRAMS[id] || id;
}

function printFigmentPayloadAndInstructions(stake: any, hex: string) {
  console.log("\n========== Figment API payload (raw JSON) ==========");
  console.log(JSON.stringify(stake, null, 2));

  const tx = Transaction.from(Buffer.from(hex.replace(/\s/g, ""), "hex"));

  console.log("\n========== Decoded transaction ==========");
  console.log("feePayer:       ", tx.feePayer?.toBase58());
  console.log("recentBlockhash:", tx.recentBlockhash);
  console.log(
    "signatures:",
    tx.signatures.map((s) => ({
      pubkey: s.publicKey.toBase58(),
      signed: !!s.signature,
    }))
  );

  console.log("\n========== Instructions ==========");
  tx.instructions.forEach((ix, i) => {
    const data = Buffer.from(ix.data);
    const programName =
      KNOWN_PROGRAMS[ix.programId.toBase58()] || ix.programId.toBase58();
    const name = decodeInstructionName(ix.programId, data);
    console.log(`\n--- Instruction [${i}] ${name} ---`);
    console.log("  programId: ", ix.programId.toBase58(), `(${programName})`);
    console.log("  data (hex):", data.toString("hex"));
    console.log("  data (len):", data.length);
    console.log("  accounts:");
    ix.keys.forEach((k, j) => {
      console.log(
        `    [${j}] ${k.pubkey.toBase58()}  signer=${k.isSigner} writable=${k.isWritable}`
      );
    });
  });
}

async function main() {
  requireEnv("FIREBLOCKS_SOL_NONCE_ACCOUNT", NONCE_ACCOUNT.trim());
  requireEnv("API_KEY", FIGMENT_API_KEY);
  if (AMOUNT_SOL < 1.1) {
    throw new Error("amount_sol must be >= 1.1 (Fireblocks minimum)");
  }

  const fireblocks = createFireblocksClient();

  const {
    address: fundingAddress,
    vaultId,
    assetId,
  } = await resolveFundingFromFireblocksVault(fireblocks);
  const fundingPubkey = new PublicKey(fundingAddress);

  const noncePubkey = new PublicKey(NONCE_ACCOUNT.trim());
  const authorityPubkey = NONCE_AUTHORITY
    ? new PublicKey(NONCE_AUTHORITY.trim())
    : fundingPubkey;

  const cluster =
    NETWORK === "mainnet" ? "mainnet-beta" : (NETWORK as "devnet" | "testnet");
  const connection = new Connection(clusterApiUrl(cluster), "confirmed");

  console.log("Network:         ", NETWORK);
  console.log("Fireblocks vault:", vaultId, `(${assetId})`);
  console.log("Funding (vault): ", fundingPubkey.toBase58());
  console.log("Vote account:    ", VOTE_ACCOUNT);
  console.log("Amount SOL:      ", AMOUNT_SOL);
  console.log("Nonce account:   ", noncePubkey.toBase58());
  console.log("Nonce authority: ", authorityPubkey.toBase58());

  await verifyNonceOnChain(connection, noncePubkey, authorityPubkey);

  const requestBody: Record<string, unknown> = {
    network: NETWORK,
    amount_sol: AMOUNT_SOL,
    vote_account: VOTE_ACCOUNT,
    funding_account: fundingPubkey.toBase58(),
    nonce_account: noncePubkey.toBase58(),
    nonce_authority: authorityPubkey.toBase58(),
  };

  console.log("\nPOST", FIGMENT_STAKE_URL);
  console.log("body:", JSON.stringify(requestBody, null, 2));

  let stake;
  try {
    stake = await createStakeTx(requestBody);
  } catch (err: any) {
    console.error(
      "Figment stake error:",
      err?.response?.data || err.message || err
    );
    process.exit(1);
  }

  console.log("\n--- Figment response ---");
  console.log("stake_account:          ", stake.stake_account);
  console.log("is_durable_nonce:       ", stake.is_durable_nonce);
  console.log("nonce_value:            ", stake.nonce_value);
  console.log("last_valid_block_height:", stake.last_valid_block_height);
  console.log("network:                ", stake.network);

  const hex = stake.unsigned_transaction_serialized;
  if (!hex) {
    throw new Error("No unsigned_transaction_serialized from Figment Stake API");
  }

  printFigmentPayloadAndInstructions(stake, hex);

  console.log("\nunsigned_transaction_serialized length:", String(hex).length);
  const tx = Transaction.from(Buffer.from(String(hex).replace(/\s/g, ""), "hex"));
  console.log("\nRequired signers:");
  tx.signatures.forEach((s, i) => {
    console.log(
      `  ${i + 1}. ${s.publicKey.toBase58()} → ${
        s.signature ? "pre-signed" : "MISSING"
      }`
    );
  });

  const completed = await signAndBroadcastWithFireblocks(
    fireblocks,
    hex,
    `Figment durable-nonce stake stake_account=${stake.stake_account || "?"} amount=${AMOUNT_SOL}`
  );

  console.log("\n--- Fireblocks result ---");
  console.log("id:      ", completed.id);
  console.log("status:  ", completed.status);
  console.log("subStatus:", completed.subStatus);
  console.log("txHash:  ", completed.txHash);

  if (completed.txHash) {
    const clusterQs =
      NETWORK === "mainnet"
        ? ""
        : "?cluster=devnet";
    console.log(
      "Explorer:",
      `https://explorer.solana.com/tx/${completed.txHash}${clusterQs}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.response?.data || e);
    process.exit(1);
  });
