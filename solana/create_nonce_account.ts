import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    NONCE_ACCOUNT_LENGTH,
    sendAndConfirmTransaction,
    Transaction,
  } from "@solana/web3.js";
  import bs58 from "bs58";
  import { config } from "dotenv";
  config();
  
  // Setup connection and wallet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  
  const privateKey = process.env.SOL_PRIVATE_KEY || "";
  const privateKeyBase58 = bs58.decode(privateKey);
  const wallet = Keypair.fromSecretKey(privateKeyBase58);
  
  async function main() {
    // 1. Generate a new keypair for the nonce account
    const nonceAccount = Keypair.generate();
  
    // 2. Rent-exempt balance for a nonce account
    const rentExempt =
      await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  
    console.log(`Funding wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`Nonce account:  ${nonceAccount.publicKey.toBase58()}`);
    console.log(`Rent-exempt lamports: ${rentExempt}`);
  
    // 3. Create + initialize nonce account
    // authority = wallet (who can advance the nonce)
    const tx = SystemProgram.createNonceAccount({
      fromPubkey: wallet.publicKey,
      noncePubkey: nonceAccount.publicKey,
      authorizedPubkey: wallet.publicKey,
      lamports: rentExempt,
    });
  
    const txId = await sendAndConfirmTransaction(connection, tx, [
      wallet,
      nonceAccount, // new account must sign
    ]);
  
    console.log(`Nonce account created. Tx Id: ${txId}`);
    console.log(`Nonce account public key: ${nonceAccount.publicKey.toBase58()}`);

    // 4. Read back nonce info
    const info = await connection.getParsedAccountInfo(nonceAccount.publicKey);
    if (info.value) {
      console.log(`Nonce account info:\n${JSON.stringify(info.value.data, null, 2)}`);
    } else {
      console.log("Nonce account not found");
    }

    const parsed: any = info.value?.data;
    const authorityFromChain =
      parsed?.parsed?.info?.authority ?? wallet.publicKey.toBase58();

    console.log("\n--- save for durable nonce staking ---");
    console.log(`SOL_NONCE_ACCOUNT=${nonceAccount.publicKey.toBase58()}`);
    console.log(`SOL_NONCE_AUTHORITY=${authorityFromChain}`);
    console.log(`FUNDING_ACCOUNT=${wallet.publicKey.toBase58()}`);
    console.log(`NETWORK=devnet`);
    console.log(
      "(nonce account secret can be discarded; authority is the funding wallet)"
    );
  }
  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });