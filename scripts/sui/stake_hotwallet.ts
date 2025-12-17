import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils';
import axios from 'axios';
import { config } from "dotenv";
config();


const stakeAmount = 1;
const validatorAccount = "0x22b35a7481fb136e5585c43421cf8ab49d0e219e902dedc40c2778acdcc7bc9c";
const delegatorAccount = "0x0e30610a83ffbbe157231e869ad6716b816d633d9c58e22b7100a66002df0afd";
const API_KEY = process.env.API_KEY // Replace with your actual API key

async function generateStakePayload(amount: number, validatorAccount: string, delegatorAccount: string) {
    const API_URL = 'https://api.figment.io/sui/stake';
    // Define request body parameters
    const requestBody = {
        network: "testnet",
        amount: amount,   
        validator_address: validatorAccount,
        delegator_address: delegatorAccount
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


async function broadcast(unsigned_transaction_serialized: string, signature: string) {
    const API_URL = 'https://api.figment.io/sui/broadcast';
    // Define request body parameters
    const requestBody = {
        network: "testnet",
        unsigned_transaction_serialized: unsigned_transaction_serialized,
        signature: signature
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
        console.log('Error:', JSON.stringify(error, null, 2));
        console.error('Error:', error.response ? error.response.data : error.message);
        
    }
};


// Sign SUI transaction
async function signTransaction(unsignedTransactionHex: string) {
    try {
        // Step 1: Set up Sui client
        const client = new SuiClient({
            url: getFullnodeUrl('testnet'), // Match your network setting
        });

        // Step 2: Load keypair from environment variable
        const privateKey = process.env.SUI_PRIVATE_KEY || "";
        
        if (!privateKey) {
            throw new Error('SUI_PRIVATE_KEY environment variable is not set');
        }

        // Step 3: Create keypair (support multiple formats)
        let keypair: Ed25519Keypair | Secp256k1Keypair | Secp256r1Keypair;
        
        // Check if it's a Bech32-encoded key (starts with "suiprivkey")
        if (privateKey.startsWith('suiprivkey')) {
            try {
                // Import from Bech32 format
                // The Sui SDK keypairs can decode Bech32 format directly
                keypair = Ed25519Keypair.fromSecretKey(privateKey);
                console.log('Using Ed25519 keypair (from Bech32 suiprivkey format)');
            } catch (bech32Error) {
                // If direct import fails, try using the SDK's decode method
                // Some SDK versions require explicit Bech32 decoding
                try {
                    // Try Secp256k1 and Secp256r1 as well
                    keypair = Secp256k1Keypair.fromSecretKey(privateKey);
                    console.log('Using Secp256k1 keypair (from Bech32 suiprivkey format)');
                } catch {
                    try {
                        keypair = Secp256r1Keypair.fromSecretKey(privateKey);
                        console.log('Using Secp256r1 keypair (from Bech32 suiprivkey format)');
                    } catch {
                        throw new Error(`Failed to import Bech32 key. Make sure it's a valid suiprivkey format. Error: ${bech32Error}`);
                    }
                }
            }
        } else {
            // Try existing formats (base64 with flag, hex)
            try {
                // Try to parse as base64 with flag byte (format: flag || secret key)
                const keypairBytes = fromBase64(privateKey);
                const flag = keypairBytes[0];
                const secretKey = keypairBytes.slice(1);

                switch (flag) {
                    case 0x00: // Ed25519
                        keypair = Ed25519Keypair.fromSecretKey(secretKey);
                        console.log('Using Ed25519 keypair');
                        break;
                    case 0x01: // Secp256k1
                        keypair = Secp256k1Keypair.fromSecretKey(secretKey);
                        console.log('Using Secp256k1 keypair');
                        break;
                    case 0x02: // Secp256r1
                        keypair = Secp256r1Keypair.fromSecretKey(secretKey);
                        console.log('Using Secp256r1 keypair');
                        break;
                    default:
                        // Fall back to Ed25519 if no flag or unknown flag
                        keypair = Ed25519Keypair.fromSecretKey(keypairBytes);
                        console.log('Using Ed25519 keypair (no flag detected)');
                }
            } catch {
                // If base64 parsing fails, try hex format (32 bytes for Ed25519)
                try {
                    const privateKeyBytes = fromHex(privateKey);
                    keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
                    console.log('Using Ed25519 keypair (from hex)');
                } catch (error) {
                    throw new Error(`Failed to parse private key. Expected suiprivkey (Bech32), base64 (with flag), or hex format. Error: ${error}`);
                }
            }
        }

        const sender = keypair.toSuiAddress();
        console.log(`Signer address: ${sender}`);

        // Step 4: Deserialize the unsigned transaction bytes
        // Convert hex string to bytes
        const unsignedTxBytes = fromHex(unsignedTransactionHex);
        const transaction = Transaction.from(unsignedTxBytes);

        console.log('Transaction deserialized successfully');

         // Step 5: Sign the transaction using the transaction's sign method
         const { bytes, signature } = await transaction.sign({
            client,
            signer: keypair,
        });

        console.log('✅ Transaction signed successfully');
        console.log(`Signature: ${signature}`);
        console.log(`Signed transaction bytes (base64): ${bytes}`);

        // Step 6: Convert signed transaction to hex format for broadcasting
        // The signed transaction bytes are in base64, convert to hex
        const signedTxBytes = fromBase64(bytes);
        const signedTxHex = Buffer.from(signedTxBytes).toString('hex');
        
        return {signedTxHex, signature};
    } catch (error: any) {
        console.error('Error signing transaction:', error.message);
        throw error;
    }
}

/**
 * Broadcast a signed Sui transaction directly to the Sui network
 * @param unsignedTransactionHex Hex-encoded unsigned transaction
 * @param signature Base64-encoded signature (with flag and public key)
 * @param network Network name: 'testnet', 'mainnet', 'devnet', or 'localnet'
 * @returns Transaction execution result with digest
 */
async function broadcastTransaction(
    unsignedTransactionHex: string,
    signature: string,
    network: 'testnet' | 'mainnet' | 'devnet' | 'localnet' = 'testnet'
) {
    try {
        // Set up Sui client
        const client = new SuiClient({
            url: getFullnodeUrl(network),
        });

        // Convert unsigned transaction hex to base64
        const unsignedTxBytes = fromHex(unsignedTransactionHex);
        const transactionBlock = toBase64(unsignedTxBytes);

        console.log('Broadcasting transaction to Sui network...');
        console.log(`Network: ${network}`);
        console.log(`Transaction Block (base64): ${transactionBlock.substring(0, 50)}...`);
        console.log(`Signature (base64): ${signature.substring(0, 50)}...`);

        // Execute the transaction
        const result = await client.executeTransactionBlock({
            transactionBlock: transactionBlock,
            signature: signature,
            options: {
                showEffects: true,
                showEvents: true,
                showObjectChanges: true,
                showBalanceChanges: true,
                showInput: true,
            },
            requestType: 'WaitForLocalExecution', // Wait for transaction to be finalized
        });

        console.log('✅ Transaction broadcasted successfully!');
        console.log(`Transaction Digest: ${result.digest}`);
        console.log(`Status: ${result.effects?.status.status}`);
        
        if (result.effects?.status.status === 'success') {
            console.log('✅ Transaction executed successfully');
        } else {
            console.error('❌ Transaction failed:', result.effects?.status);
        }

        return result;
    } catch (error: any) {
        console.error('❌ Error broadcasting transaction:', error.message);
        if (error.data) {
            console.error('Error details:', JSON.stringify(error.data, null, 2));
        }
        throw error;
    }
}


async function main() {
    try {
        // generate stake payload
        let response = await generateStakePayload(stakeAmount, validatorAccount, delegatorAccount);
        let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
        console.log('Unsigned Transaction:', unsignedTransactionHex);

        // sign transaction
        let  {signedTxHex, signature} = await signTransaction(unsignedTransactionHex);
        console.log('Fully Signed Transaction:', signedTxHex);

        // broadcast transaction
        // let result = await broadcast(unsignedTransactionHex, signature);
        let result = await broadcastTransaction(unsignedTransactionHex, signature);
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