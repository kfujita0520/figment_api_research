import {
    Transaction,
    Keypair,
    PublicKey,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import axios from 'axios';
import { config } from "dotenv";
config();



const validatorVoteAccount = "FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f";
const fundingAccount = "7Dc8UevAZLTyehmuprb96pVuAmdcQh6hCdzVx7HBk4WA";
const stakeAccount = "6tNSopikR5tytMqWcz87SA6w4h4KVHG9wubwfWMpmA6g";
const API_KEY = process.env.API_KEY // Replace with your actual API key

async function generateUnDelegatePayload(stakeAccount: string) {
    const API_URL = 'https://api.figment.io/solana/undelegate';
    // Define request body parameters
    const requestBody = {
        network: "devnet",
        stake_account: stakeAccount
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

async function broadcast(transaction_payload: string) {
    const API_URL = 'https://api.figment.io/solana/broadcast';
    // Define request body parameters
    const requestBody = {
        network: "devnet",
        transaction_payload: transaction_payload
    };

    try {
        const response = await axios.post(API_URL, requestBody, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

async function signTransaction(unsignedTransactionHex: string) {
    
    try {
        const privateKey = process.env.SOL_PRIVATE_KEY || "";
        const privateKeyBase58 = bs58.decode(privateKey);
        const wallet = Keypair.fromSecretKey(privateKeyBase58);

        // 1️⃣ Convert HEX transaction to Buffer
        const transactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');

        // 2️⃣ Deserialize transaction
        const transaction = Transaction.from(transactionBuffer);
        

        // 4️⃣ Sign the transaction (add your signature)
        transaction.partialSign(wallet); // This adds your signature to the existing ones
        
        
        //verify the signature status is all signed
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
        return fullySignedTransactionHex;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};


async function main() {
    try {
        // generate stake payload
        let response = await generateUnDelegatePayload(stakeAccount);
        let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
        console.log('Unsigned Transaction:', unsignedTransactionHex);

        // sign transaction
        let fullySignedTransactionHex = await signTransaction(unsignedTransactionHex);
        console.log('Fully Signed Transaction:', fullySignedTransactionHex);

        // broadcast transaction
        let result = await broadcast(fullySignedTransactionHex);
        console.log('Response:', result);

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