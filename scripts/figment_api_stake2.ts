import {
  Connection,
  Transaction,
  Keypair,
  clusterApiUrl,
  PublicKey,
  Message,
  sendAndConfirmRawTransaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import axios from 'axios';
import { config } from "dotenv";
config();



const validatorVoteAccount = "FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f";
const fundingAccount = "7Dc8UevAZLTyehmuprb96pVuAmdcQh6hCdzVx7HBk4WA";
const API_KEY = process.env.API_KEY // Replace with your actual API key

async function stake(amount: number, voteAccount: string, fundingAccount: string) {
  const API_URL = 'https://api.figment.io/solana/stake';
  // Define request body parameters
  const requestBody = {
      network: "devnet",
      amount_sol: amount,   // Replace with actual end date (YYYY-MM-DD) or epoch timestamp
      vote_account: voteAccount,
      funding_account: fundingAccount
  };

  try {
      const response = await axios.post(API_URL, requestBody, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': API_KEY
          }
      });

      console.log('Response:', response.data);
      return response.data;
  } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);
  }
};


async function main() {
  try {
    let response = await stake(0.01, validatorVoteAccount, fundingAccount);
    let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
    console.log('Unsigned Transaction:', unsignedTransactionHex);
    // 🔹 Connect to the Solana network
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

    const privateKey = process.env.PRIVATE_KEY || "";
    const privateKeyBase58 = bs58.decode(privateKey);
    const wallet = Keypair.fromSecretKey(privateKeyBase58);

    // 1️⃣ Convert HEX transaction to Buffer
    const transactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');

    // 2️⃣ Deserialize transaction
    const transaction = Transaction.from(transactionBuffer);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    transaction.signatures.forEach((sig, index) => {
      if (sig.signature) {
        const isValid = nacl.sign.detached.verify(
          transaction.serializeMessage(),
          sig.signature,
          new PublicKey(sig.publicKey).toBytes()
        );
        console.log(`Signature ${index + 1}: ${sig.publicKey} valid: ${isValid}`);
      }
    });
    console.log('Verify Signature: ', transaction.verifySignatures());

    // 4️⃣ Sign the transaction (add your signature)
    transaction.partialSign(wallet); // This adds your signature to the existing ones
    console.log("🔍 **Required Signers & Signatures:**");
    transaction.signatures.forEach((sig, index) => {
      const status = sig.signature ? "✅ Signed" : "❌ Missing";
      console.log(`${index + 1}. ${sig.publicKey.toBase58()} → ${status}`);
    });
    const missingSigners = transaction.signatures.filter(sig => sig.signature === null);
    
    if (missingSigners.length > 0) {
      console.log("⚠️ Transaction is still missing signatures from:", missingSigners.map(s => s.publicKey.toBase58()));
      console.log("🔹 Partially Signed Transaction (HEX):", transaction.serialize().toString('hex'));
      console.log("✅ Share this with the next signer.");
      return; // Exit early since the transaction is incomplete
    }

    console.log('Verify Signature: ', transaction.verifySignatures());
    transaction.signatures.forEach((sig, index) => {
      if (sig.signature) {
        const isValid = nacl.sign.detached.verify(
          transaction.serializeMessage(),
          sig.signature,
          new PublicKey(sig.publicKey).toBytes()
        );
        console.log(`Signature ${index + 1} valid: ${isValid}`);
      }
    });


    // 5️⃣ Serialize the fully signed transaction
    const fullySignedTransactionBuffer = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
    const fullySignedTransactionHex = fullySignedTransactionBuffer.toString('hex');
    console.log("Fully Signed Transaction (Hex):", fullySignedTransactionHex);

    // 6️⃣ Broadcast the signed transaction
    // const delegateTxId = await sendAndConfirmTransaction(connection, transaction, [
    //   wallet,
    // ]);
    // console.log(
    //   `Stake account delegated to ${validatorVoteAccount}. Tx Id: ${delegateTxId}`
    // );
    const signatureString = await connection.sendRawTransaction(fullySignedTransactionBuffer, {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });

    console.log("✅ Transaction broadcasted successfully!");
    console.log("🔗 Transaction Signature:", signatureString);


  } catch (error) {
    console.error("❌ Error broadcasting transaction:", error);
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