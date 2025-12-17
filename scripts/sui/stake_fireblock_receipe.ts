import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { messageWithIntent } from '@mysten/sui/cryptography';
import { fromBase64, fromHex, toBase64 } from '@mysten/sui/utils';
import axios from 'axios';
import fs from "fs";
import { FireblocksSDK, PeerType, TransactionOperation } from "fireblocks-sdk";
import { config } from "dotenv";
config();


const stakeAmount = 1;
const validatorAccount = "0x22b35a7481fb136e5585c43421cf8ab49d0e219e902dedc40c2778acdcc7bc9c";
const delegatorAccount = "0xb0e0bce616aacbd836122d89a0f20b68abdecf566a4fe0742fa9fe6c9563455c";
const API_KEY = process.env.API_KEY // Replace with your actual API key
const fireblocks_apiSecret = fs.readFileSync("./credentials/fireblocks_secret.key", "utf8");
const fireblocks_apiKey = process.env.FIREBLOCKS_API_KEY;
const fireblocks = new FireblocksSDK(fireblocks_apiSecret, fireblocks_apiKey);
const vaultAccountId = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS;
const network = process.env.NETWORK || "testnet";


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
        console.error('Error:', JSON.stringify(error, null, 2));
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

        return response;
    } catch (error) {
        console.log('Error:', JSON.stringify(error, null, 2));
        console.error('Error:', error.response ? error.response.data : error.message);
        
    }
};


/**
 * Creates the intent message digest that Sui requires for transaction signing
 * Uses dynamic import to avoid direct dependency on blake2b
 */
async function createIntentMessageDigest(transactionBytes: Uint8Array): Promise<Uint8Array> {
  // Dynamically import blake2b (same library the SDK uses internally)
  const { blake2b } = await import('@noble/hashes/blake2b');
  
  // Create intent message
  const intentMessage = messageWithIntent('TransactionData', transactionBytes);
  
  // Hash the intent message with blake2b (32 bytes output)
  const digest = blake2b(intentMessage, { dkLen: 32 });
  
  return digest;
}

/**
 * Verifies that the Fireblocks signature is valid for the transaction
 */
async function verifyFireblocksSignature(
  transactionBytes: Uint8Array,
  fullSig: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Create intent message digest (what Sui expects to be signed)
    const digest = await createIntentMessageDigest(transactionBytes);
    
    // Get signature and public key
    const signatureBytes = fromHex(fullSig);
    const publicKeyBytes = fromHex(publicKey);
    const publicKeyObj = new Ed25519PublicKey(publicKeyBytes);
    
    // Verify signature over the digest
    return await publicKeyObj.verify(digest, signatureBytes);
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
}

async function signSuiTxWithFireblocks(signing_payload: string): Promise<any> {
  // Convert hex to bytes
  const transactionBytes = fromHex(signing_payload);
  
  // Create the intent message digest that Sui requires
  // This is what Fireblocks should sign, NOT the raw transaction bytes
  const intentMessageDigest = await createIntentMessageDigest(transactionBytes);
  
  // Convert digest to hex for Fireblocks
  const digestHex = Buffer.from(intentMessageDigest).toString('hex');
  
  console.log('Raw transaction bytes length:', transactionBytes.length);
  console.log('Intent message digest (hex):', digestHex);
  console.log('Intent message digest length:', intentMessageDigest.length, 'bytes');
  
  // 1. Create a RAW transaction for signing
  // IMPORTANT: Send the intent message digest, not the raw transaction!
  const txRes = await fireblocks.createTransaction({
    assetId: network === "mainnet" ? "SUI" : "SUI_TEST",
    source: { type: PeerType.VAULT_ACCOUNT, id: vaultAccountId },
    operation: TransactionOperation.RAW,
    extraParameters: {
      rawMessageData: {
        messages: [
          { content: digestHex }, // Send intent message digest, not raw transaction
        ]
      },
      algorithm: "MPC_EDDSA_ED25519"
    },
    note: "Sign Sui transaction (intent message digest)"
  });

  console.log("Transaction created:", txRes.id);

  // 2. Wait for the transaction to be signed
  let tx;
  do {
    tx = await fireblocks.getTransactionById(txRes.id);
    if (!["CONFIRMED", "CANCELLED", "REJECTED", "FAILED"].includes(tx.status)) {
      console.log(`Waiting for signature... Current status: ${tx.status}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } while (!["COMPLETED", "CONFIRMED", "CANCELLED", "REJECTED", "FAILED"].includes(tx.status));

  // 3. Extract signatures
  const signedMessages = tx.signedMessages;
  console.log("Signed Messages:", signedMessages);

  console.log('Public Key:', publicKeyToSuiAddress(signedMessages[0].publicKey));
  console.log('Full Sig:', signedMessages[0].signature.fullSig);

  let fullSig = signedMessages[0].signature.fullSig;
  let publicKey = signedMessages[0].publicKey;

  // Verify the signature before returning
  const isValid = await verifyFireblocksSignature(transactionBytes, fullSig, publicKey);
  if (!isValid) {
    throw new Error(
      'Fireblocks signature verification failed. ' +
      'The signature does not match the intent message digest. ' +
      'Make sure Fireblocks signed the intent message digest, not the raw transaction bytes.'
    );
  }
  console.log('✅ Signature verification passed');

  return { fullSig, publicKey };
}

/**
 * Convert Fireblocks public key (hex) to Sui address
 * @param publicKeyHex Hex-encoded public key from Fireblocks
 * @returns Sui address string
 */
function publicKeyToSuiAddress(publicKeyHex: string): string {
  try {
      // Remove '0x' prefix if present
      const cleanHex = publicKeyHex.startsWith('0x') 
          ? publicKeyHex.slice(2) 
          : publicKeyHex;
      
      // Convert hex to bytes
      const publicKeyBytes = fromHex(cleanHex);
      
      // Create Ed25519PublicKey object
      const publicKey = new Ed25519PublicKey(publicKeyBytes);
      
      // Convert to Sui address
      const suiAddress = publicKey.toSuiAddress();
      console.log('Sui Address:', suiAddress);
      
      return suiAddress;
  } catch (error) {
      throw new Error(`Failed to convert public key to Sui address: ${error}`);
  }
}

/**
 * Converts a Fireblocks signed message to Sui's serialized signature format
 * Sui signature format: flag (1 byte) || signature (64 bytes) || publicKey (32 bytes)
 */
function convertFireblocksSignatureToSui(
  fullSig: string,
  publicKey: string
): string {
  // ED25519 flag is 0x00
  const flag = 0x00;
  
  // Convert hex strings to bytes using the Sui SDK utility
  const signatureBytes = fromHex(fullSig);
  const publicKeyBytes = fromHex(publicKey);
  
  // Validate lengths
  if (signatureBytes.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${signatureBytes.length}`);
  }
  if (publicKeyBytes.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${publicKeyBytes.length}`);
  }
  
  // Create serialized signature: flag || signature || publicKey
  const serializedSignature = new Uint8Array(1 + signatureBytes.length + publicKeyBytes.length);
  serializedSignature.set([flag], 0);
  serializedSignature.set(signatureBytes, 1);
  serializedSignature.set(publicKeyBytes, 1 + signatureBytes.length);
  
  // Return as base64 encoded string
  return toBase64(serializedSignature);
}


async function main() {
    try {
        // generate stake payload
        let response = await generateStakePayload(stakeAmount, validatorAccount, delegatorAccount);
        let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
        // let unsignedTransactionHex = "000003000800ca9a3b0000000001010000000000000000000000000000000000000000000000000000000000000005010000000000000001002022b35a7481fb136e5585c43421cf8ab49d0e219e902dedc40c2778acdcc7bc9c020200010100000000000000000000000000000000000000000000000000000000000000000000030a7375695f73797374656d11726571756573745f6164645f7374616b6500030101000300000000010200b0e0bce616aacbd836122d89a0f20b68abdecf566a4fe0742fa9fe6c9563455c0298d3c1ed4065ad8d3caad4d022f1b8c20aa3b018de676c3bd4e9564c610c20075b8141290000000020dc59a6c694e3967c88d51e8236843c73bcfd1663169994d3b3c88a50a38809efb0d4bf02284906fb0c40d166b8491ee7816e9db3b6c4f2060d2a6a33eda4569b424e5028000000002002e7ec76b525847c0b5ee7f6ff1035c8749c91b678a7b7fa688dd39357613d42b0e0bce616aacbd836122d89a0f20b68abdecf566a4fe0742fa9fe6c9563455ce80300000000000000e1f5050000000000"
        // let unsignedTransactionHex = "000003000800ca9a3b0000000001010000000000000000000000000000000000000000000000000000000000000005010000000000000001002022b35a7481fb136e5585c43421cf8ab49d0e219e902dedc40c2778acdcc7bc9c020200010100000000000000000000000000000000000000000000000000000000000000000000030a7375695f73797374656d11726571756573745f6164645f7374616b65000301010003000000000102000e30610a83ffbbe157231e869ad6716b816d633d9c58e22b7100a66002df0afd04970ece4fa99d02794e81ca464315e15285b545b0282d274a3c97441722b3e0a6298141290000000020852dbd0eadee0c1cda5f9a910ec3bde33e7d5bff60a62effe9e4b6bce8773cac3b413808417ac22313c4cff3e556f69b0c10ba43164e1fbe83a79dafd68584099514d014000000002081efae14450622d8b7588106fa9635e4875f72829c9b477937a75717231a78cc5d73df8fe7aa5123ae24c322a96fd715f3ce4be146516ca714dd748c61adc2489414d0140000000020334277e52fe53fef78b2e34185bb62a7f8abf30bad9f2da46cb3cafb69ea6e0697365b7670b818a328a8dd76664f610c71ce774cb4cf770b5b842f8b695e7ae39214d01400000000208aff773fe5409e9018985c55bd06158ddc467e81bcb7efa662a1641264921cac0e30610a83ffbbe157231e869ad6716b816d633d9c58e22b7100a66002df0afde80300000000000000e1f5050000000000";
        console.log('Unsigned Transaction:', unsignedTransactionHex);

        // sign transaction - now sends intent message digest to Fireblocks
        let { fullSig, publicKey } = await signSuiTxWithFireblocks(unsignedTransactionHex);
        console.log('Fully Signed Transaction:', fullSig);
        let suiSignature = convertFireblocksSignatureToSui(fullSig, publicKey);
        console.log('Sui Signature:', suiSignature);
        
        // broadcast transaction
        let result = await broadcast(unsignedTransactionHex, suiSignature);
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