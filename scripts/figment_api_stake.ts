import {
  Connection,
  Transaction,
  Keypair,
  clusterApiUrl,
  PublicKey,
  Message,
  sendAndConfirmRawTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { config } from "dotenv";
config();

// 🔹 Replace with your actual unsigned transaction (HEX format)
const unsignedTransactionHex = "0200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b6dca0709c0069d97349ae8310888a4814f1b0467ea3ca791d93a19e2263e7c2827d1675e3a9eb8b2e17b9f8c6d6ddafc1dd078d740c0d35297f692d32ba44040200080a5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f089dbe6bc8743719a61c70f71ca4d6fedd3e744460ea204593f19de1ed8e818400000000000000000000000000000000000000000000000000000000000000000306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000ea1a2a344a8f706360bf067dc7465fe5db8354dd88c12c94956caad628cfddef06a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc00000000006a1d817a502050b680791e6ce6db88e1e5b7150f61fc6790a4eb4d10000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b210000000006a7d517192c5c51218cc94c3d4af17f58daee089ba1fd44e3dbd98a0000000006a7d517193584d0feed9bb3431d13206be544281b57b8566cc5375ff40000004f1c08dde2731e1a283d9819a8f434d4b5500025c476d447bcaa1a15ac361502040202000134000000008096980000000000c80000000000000006a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc0000000000502010874000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f000000000000000000000000000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f03000903204e00000000000005060104070906000402000000"; // Truncated for readability
const partiallySignedTransactionHex = "0200080a5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f03407729ffabb19e7bc61a9525acba759893c8de7409381bfc17aa20291ab5b000000000000000000000000000000000000000000000000000000000000000000306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000ea1a2a344a8f706360bf067dc7465fe5db8354dd88c12c94956caad628cfddef06a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc00000000006a1d817a502050b680791e6ce6db88e1e5b7150f61fc6790a4eb4d10000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b210000000006a7d517192c5c51218cc94c3d4af17f58daee089ba1fd44e3dbd98a0000000006a7d517193584d0feed9bb3431d13206be544281b57b8566cc5375ff400000068fdf8a93d09745e7ba6ddbecf4687c40fcf4c3e37e10a0ed923bec491393a3b0402020001340000000000e1f50500000000c80000000000000006a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc0000000000502010874000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f000000000000000000000000000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f03000903204e00000000000005060104070906000402000000";





async function main() {
  try {
    // 🔹 Connect to the Solana network
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

    const privateKey = process.env.PRIVATE_KEY || "";
    const privateKeyBase58 = bs58.decode(privateKey);
    const wallet = Keypair.fromSecretKey(privateKeyBase58);

    // 1️⃣ Convert HEX transaction to Buffer
    const transactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');

    // 2️⃣ Deserialize transaction
    const transaction = Transaction.from(transactionBuffer);
    //console.log('Transaction: ', transaction);
    //transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    transaction.signatures.forEach((sig, index) => {
      if (sig.signature) {
        const isValid = nacl.sign.detached.verify(
          transaction.serializeMessage(),
          sig.signature,
          new PublicKey(sig.publicKey).toBytes()
        );
        console.log(`Signature: ${sig.publicKey} valid: ${isValid}`);
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