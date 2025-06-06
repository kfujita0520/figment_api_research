import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    StakeProgram,
    Authorized,
    sendAndConfirmTransaction,
    Lockup,
    PublicKey,
  } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "dotenv";
config();

const validatorVoteAccount = "FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f";
  
async function main() {
    // Setup our connection and wallet
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

    const privateKey = process.env.PRIVATE_KEY || "";
    const privateKeyBase58 = bs58.decode(privateKey);
    const wallet = Keypair.fromSecretKey(privateKeyBase58);

  
    // Create a keypair for our stake account
    const stakeAccount = Keypair.generate();
  
    // Calculate how much we want to stake
    const minimumRent = await connection.getMinimumBalanceForRentExemption(
      StakeProgram.space
    );
    const amountUserWantsToStake = LAMPORTS_PER_SOL / 1000; // This is can be user input. For now, we'll hardcode to 0.5 SOL
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
  
    const createStakeAccountTxId = await sendAndConfirmTransaction(
      connection,
      createStakeAccountTx,
      [
        wallet,
        stakeAccount, // Since we're creating a new stake account, we have that account sign as well
      ]
    );
    console.log(`Stake account created. Tx Id: ${createStakeAccountTxId}`);
    console.log(`Stake account public key: ${stakeAccount.publicKey.toBase58()}`);
  
    // Check our newly created stake account balance. This should be 0.5 SOL.
    let stakeBalance = await connection.getBalance(stakeAccount.publicKey);
    console.log(`Stake account balance: ${stakeBalance / LAMPORTS_PER_SOL} SOL`);
  
    // Verify the status of our stake account. This will start as inactive and will take some time to activate.
    // Get and print detailed stake account info
    let stakeAccountInfo = await connection.getParsedAccountInfo(stakeAccount.publicKey);
    if (stakeAccountInfo.value) {
        const stakeAccountData = stakeAccountInfo.value.data;
        console.log(`Stake account info: ${JSON.stringify(stakeAccountData, null, 2)}`);
    } else {
        console.log("Stake account not found");
    }
  
    // To delegate our stake, we first have to select a validator. Here we get all validators and select the first active one.
    const selectedValidatorPubkey = new PublicKey(validatorVoteAccount);
  
    // With a validator selected, we can now setup a transaction that delegates our stake to their vote account.
    const delegateTx = StakeProgram.delegate({
      stakePubkey: stakeAccount.publicKey,
      authorizedPubkey: wallet.publicKey,
      votePubkey: selectedValidatorPubkey,
    });
  
    const delegateTxId = await sendAndConfirmTransaction(connection, delegateTx, [
      wallet,
    ]);
    console.log(
      `Stake account delegated to ${selectedValidatorPubkey}. Tx Id: ${delegateTxId}`
    );

    // Get and print detailed stake account info
    stakeAccountInfo = await connection.getParsedAccountInfo(stakeAccount.publicKey);
    if (stakeAccountInfo.value) {
        const stakeAccountData = stakeAccountInfo.value.data;
        console.log(`Stake account info: ${JSON.stringify(stakeAccountData, null, 2)}`);
    } else {
        console.log("Stake account not found");
    }

};

  // We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
.then(() => process.exit(0))
.catch((error) => {
    console.error(error);
    process.exit(1);
});