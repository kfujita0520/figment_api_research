import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    StakeProgram,
    Authorized,
    Transaction,
    Lockup,
    PublicKey,
  } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "dotenv";
config();

// User Input
const validatorVoteAccount = process.env.SOL_VOTE_ACCCOUNT || "";
const amount = "0.01";

// config
// Setup our connection and wallet
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const privateKey = process.env.SOL_PRIVATE_KEY || "";
const privateKeyBase58 = bs58.decode(privateKey);
const wallet = Keypair.fromSecretKey(privateKeyBase58);


function solToLamportsNumber(sol: string): number {
  const input = sol.trim();
  if (!/^\d+(\.\d+)?$/.test(input)) {
    throw new Error(`Invalid SOL amount: "${sol}"`);
  }

  const decimals = LAMPORTS_PER_SOL.toString().length - 1; // 9
  const [whole, frac = ""] = input.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);

  const lamportsBig =
    BigInt(whole) * BigInt(LAMPORTS_PER_SOL) +
    BigInt(fracPadded || "0");

  if (lamportsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Lamports exceed safe number range: ${lamportsBig.toString()}`);
  }

  return Number(lamportsBig);
}

type SignedTxPayload = {
  rawTx: Buffer;
  blockhash: string;
  lastValidBlockHeight: number;
};

type UnsignedTxPayload = {
  unsignedTxBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

function encodeUnsignedTx(tx: Transaction): string {
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

function decodeUnsignedTx(unsignedTxBase64: string): Transaction {
  return Transaction.from(Buffer.from(unsignedTxBase64, "base64"));
}

async function buildUnsignedTxString(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey
): Promise<{ unsignedTxBase64: string; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;

  return {
    unsignedTxBase64: encodeUnsignedTx(tx),
    blockhash,
    lastValidBlockHeight,
  };
}

function signTransaction(
  unsignedTxBase64: string,
  signers: Keypair[],
  blockhash: string,
  lastValidBlockHeight: number
): SignedTxPayload {
  const tx = decodeUnsignedTx(unsignedTxBase64);
  tx.partialSign(...signers);

  return {
    rawTx: tx.serialize(),
    blockhash,
    lastValidBlockHeight,
  };
}


async function broadcastSignedTransaction(
  connection: Connection,
  signed: SignedTxPayload
): Promise<string> {
  const signature = await connection.sendRawTransaction(signed.rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(
    {
      signature,
      blockhash: signed.blockhash,
      lastValidBlockHeight: signed.lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}

async function printStakeAccountInfo(connection: Connection, stakeAccount: Keypair) {
  // Check our newly created stake account balance.
  let stakeBalance = await connection.getBalance(stakeAccount.publicKey);
  console.log(`Stake account balance: ${stakeBalance / LAMPORTS_PER_SOL} SOL`);
  let stakeAccountInfo = await connection.getParsedAccountInfo(stakeAccount.publicKey);
  if (stakeAccountInfo.value) {
    const stakeAccountData = stakeAccountInfo.value.data;
    console.log(`Stake account info: ${JSON.stringify(stakeAccountData, null, 2)}`);
  } else {
    console.log("Stake account not found");
  }
}

async function createStakeAccountTx(connection: Connection, wallet: Keypair, stakeAccount: Keypair): Promise<UnsignedTxPayload> {
  // Calculate how much we want to stake
  const minimumRent = await connection.getMinimumBalanceForRentExemption(
    StakeProgram.space
  );

  const amountUserWantsToStake = solToLamportsNumber(amount);
  console.log(`Amount to stake: ${amountUserWantsToStake / LAMPORTS_PER_SOL} SOL`);
  const amountToStake = minimumRent + amountUserWantsToStake;

  // Setup a transaction to create our stake account
  // Note: `StakeProgram.createAccount` returns a `Transaction` preconfigured with the necessary `TransactionInstruction`s
  const createStakeAccountTx = StakeProgram.createAccount({
    authorized: new Authorized(wallet.publicKey, wallet.publicKey), // Here we set two authorities: Stake Authority and Withdrawal Authority. Both are set to our wallet.
    fromPubkey: wallet.publicKey,
    lamports: amountToStake,
    lockup: new Lockup(0, 0, wallet.publicKey), // Optional. We'll set this to 0 for demonstration purposes.
    stakePubkey: stakeAccount.publicKey,
  });

  const unsigned = await buildUnsignedTxString(connection, createStakeAccountTx, wallet.publicKey);
  return unsigned;
}

async function createDelegateTx(connection: Connection, wallet: Keypair, stakeAccount: Keypair, validatorPubKey: PublicKey): Promise<UnsignedTxPayload> {
  const delegateTx = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: wallet.publicKey,
    votePubkey: validatorPubKey,
  });
  
  // Build unsigned tx string
  const unsignedDelegate = await buildUnsignedTxString(
    connection,
    delegateTx,
    wallet.publicKey
  );
  return unsignedDelegate;
}
  
async function main() {

    // Create a keypair for the stake account to be created
    const stakeAccount = Keypair.generate();

    // Create the unsigned transaction to create the stake account
    const unsigned = await createStakeAccountTx(connection, wallet, stakeAccount);

    // Sign the unsigned transaction
    const signed = signTransaction(
      unsigned.unsignedTxBase64,
      [wallet, stakeAccount],
      unsigned.blockhash,
      unsigned.lastValidBlockHeight
    );
  
    // Broadcast the signed transaction
    const createStakeAccountTxId = await broadcastSignedTransaction(connection, signed);
    console.log(`Stake account created. Tx Id: ${createStakeAccountTxId}`);
    console.log(`Stake account public key: ${stakeAccount.publicKey.toBase58()}`);
  
    await printStakeAccountInfo(connection, stakeAccount);
  
    // set up the validator to delegate to
    const validatorPubKey = new PublicKey(validatorVoteAccount);
  
    // With a validator selected, we can now setup a transaction that delegates our stake to their vote account.
    const unsignedDelegate = await createDelegateTx(connection, wallet, stakeAccount, validatorPubKey);

    // Sign the unsigned delegate transaction
    const signedDelegate = signTransaction(
      unsignedDelegate.unsignedTxBase64,
      [wallet],
      unsignedDelegate.blockhash,
      unsignedDelegate.lastValidBlockHeight
    );

    // Broadcast signed tx
    const delegateTxId = await broadcastSignedTransaction(connection, signedDelegate);
    console.log(`Stake account delegated to ${validatorPubKey}. Tx Id: ${delegateTxId}`);

    // print detailed stake account info
    await printStakeAccountInfo(connection, stakeAccount);

};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
.then(() => process.exit(0))
.catch((error) => {
    console.error(error);
    process.exit(1);
});