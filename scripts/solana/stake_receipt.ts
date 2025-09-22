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


const stakeAmount = 0.01;
const validatorVoteAccount = "FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f";
const fundingAccount = "7Dc8UevAZLTyehmuprb96pVuAmdcQh6hCdzVx7HBk4WA";
const API_KEY = process.env.API_KEY // Replace with your actual API key

async function generateStakePayload(amount: number, voteAccount: string, fundingAccount: string) {
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

async function getTxStatus(txHash: string) {
    const API_URL = 'https://api.figment.io/solana/tx';

    try {
        console.log('Getting transaction status for:', txHash);
        const response = await axios.get(API_URL, {
            params: {
                network: "devnet",
                hash: txHash
            },
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

async function broadcastAndWaitForCompletion(
    transactionPayload: string, 
    maxRetries: number = 30, 
    retryDelay: number = 2000
): Promise<{txHash: string, status: any, success: boolean}> {
    try {
        console.log('🚀 Broadcasting transaction...');
        
        // Step 1: Broadcast the transaction
        const broadcastResult = await broadcast(transactionPayload);
        console.log('Broadcast Result:', broadcastResult.transaction_hash);
        
        if (!broadcastResult.transaction_hash) {
            throw new Error('Failed to get transaction hash from broadcast response');
        }
        
        const txHash = broadcastResult.transaction_hash;
        console.log('✅ Transaction broadcasted successfully!');
        console.log('�� Transaction Hash:', txHash);
        console.log('🔍 Waiting for transaction confirmation...');
        
        // Step 2: Wait for transaction completion with polling
        let attempts = 0;
        let finalStatus = null;
        
        while (attempts < maxRetries) {
            attempts++;
            console.log(`📊 Checking status (attempt ${attempts}/${maxRetries})...`);
            
            try {
                const statusResult = await getTxStatus(txHash);
                console.log('Status Result:', statusResult);
                
                if (statusResult && statusResult.data) {
                    const status = statusResult.data;
                    console.log(`📈 Transaction Status: ${status.status || 'Unknown'}`);
                    
                    // Check if transaction is confirmed/finalized
                    if (status.status === 'confirmed' || status.status === 'finalized' || status.status === 'success') {
                        console.log('🎉 Transaction confirmed successfully!');
                        finalStatus = status;
                        break;
                    } else if (status.status === 'failed' || status.status === 'error') {
                        console.log('❌ Transaction failed!');
                        finalStatus = status;
                        break;
                    }
                }
                
                // Wait before next check
                if (attempts < maxRetries) {
                    console.log(`⏳ Waiting ${retryDelay}ms before next check...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
                
            } catch (statusError) {
                console.log(`⚠️ Status check failed (attempt ${attempts}):`, statusError.message);
                
                // If it's the last attempt, don't wait
                if (attempts < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }
        
        // Step 3: Return final result
        if (finalStatus) {
            const success = finalStatus.status === 'confirmed' || finalStatus.status === 'finalized' || finalStatus.status === 'success';
            return {
                txHash,
                status: finalStatus,
                success
            };
        } else {
            console.log('⏰ Transaction status check timed out after maximum retries');
            return {
                txHash,
                status: { status: 'timeout', message: 'Status check timed out' },
                success: false
            };
        }
        
    } catch (error) {
        console.error('❌ Error in broadcastAndWaitForCompletion:', error);
        throw error;
    }
}

async function signTransaction(unsignedTransactionHex: string) {
    
    try {
        const privateKey = process.env.SOL_PRIVATE_KEY || "";
        const privateKeyBase58 = bs58.decode(privateKey);
        const wallet = Keypair.fromSecretKey(privateKeyBase58);

        // 1️⃣ Convert HEX transaction to Buffer
        const transactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');

        // 2️⃣ Deserialize transaction
        const transaction = Transaction.from(transactionBuffer);   

        // 3️⃣ Sign the transaction (add your signature)
        transaction.partialSign(wallet); // This adds your signature to the existing ones
        
        // 4️⃣ verify the signature status is all signed
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
        let response = await generateStakePayload(stakeAmount, validatorVoteAccount, fundingAccount);
        let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
        console.log('Unsigned Transaction:', unsignedTransactionHex);

        // sign transaction
        let fullySignedTransactionHex = await signTransaction(unsignedTransactionHex);
        console.log('Fully Signed Transaction:', fullySignedTransactionHex);

        // broadcast transaction
        let result = await broadcastAndWaitForCompletion(fullySignedTransactionHex);
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