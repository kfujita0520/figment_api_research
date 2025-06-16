import axios from "axios";
import { ethers, SigningKey } from "ethers";
import { config } from "dotenv";
config();

// Your MetaMask private key (KEEP THIS SECRET)
const privateKey = process.env.PRIVATE_KEY; // Replace with your actual private key
const apiKey = process.env.API_KEY;

// Public RPC node
const rpcUrl = process.env.RPC_URL; // Replace with your actual RPC URL
const provider = new ethers.JsonRpcProvider(rpcUrl);

// API request details for the Figment API
const url = "https://api.figment.io/ethereum/validators";
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": apiKey, // Replace with your actual API key
};
const withdrawalAddress = process.env.WITHDRAWAL_ADDRESS; // Replace with your actual withdrawal address
const data = {
  network: "hoodi",
  validators_count: 1,
  amount: "32",
  withdrawal_address: withdrawalAddress,
  funding_address: withdrawalAddress,
  fee_recipient_address: withdrawalAddress,
  region: "ca-central-1",
  credentials_prefix: '0x02',
};

/**
 * Generate signature for unsigned transaction using ethers.js v6
 * @param unsignedTransactionSerialized The unsigned transaction hex string
 * @param privateKey The private key to sign with (with or without 0x prefix)
 * @returns The signature hex string
 */
const generateSignatureFromUnsignedTx = async (
  unsignedTransactionSerialized: string,
  privateKey: string
): Promise<string> => {
  try {
    console.log("=== Generating Signature ===");
    
    // 1. Parse the unsigned transaction
    const tx = ethers.Transaction.from(unsignedTransactionSerialized);
    console.log("Parsed transaction:");
    console.log("  Chain ID:", tx.chainId);
    console.log("  To:", tx.to);
    console.log("  Value:", ethers.formatEther(tx.value), "ETH");
    
    // 2. Get the unsigned hash (this is what we need to sign)
    const messageHash = tx.unsignedHash;
    console.log("Message hash to sign:", messageHash);
    
    // 3. Format private key (ensure 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    
    // 4. Create signing key and sign the hash
    const signingKey = new ethers.SigningKey(formattedPrivateKey);
    const signature = signingKey.sign(messageHash);
    
    console.log("Generated signature components:");
    console.log("  r:", signature.r);
    console.log("  s:", signature.s);
    console.log("  v:", signature.v);
    console.log("  yParity:", signature.yParity);
    console.log("  serialized:", signature.serialized);
    console.log("  compactSerialized:", signature.compactSerialized);
    
    // 5. Verify the signature we just generated
    const recoveredPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature);
    const recoveredAddress = ethers.computeAddress(recoveredPublicKey);
    const walletAddress = ethers.computeAddress(signingKey.publicKey);
    
    console.log("Wallet address:", walletAddress);
    console.log("Recovered address:", recoveredAddress);
    console.log("Signature verification:", recoveredAddress.toLowerCase() === walletAddress.toLowerCase());
    
    console.log("=============================");
    
    // Return the serialized signature (standard format)
    return signature.serialized;
    
  } catch (error) {
    console.error("Error generating signature:", error);
    throw error;
  }
};

/**
 * Verify unsigned transaction and signature using ethers.js v6
 * @param unsignedTransactionSerialized The unsigned transaction hex string
 * @param signature The signature hex string
 * @param expectedAddress The expected signer address
 * @returns boolean indicating if signature is valid
 */
const verifyTransactionAndSignature = async (
  unsignedTransactionSerialized: string, 
  signature: string, 
  expectedAddress: string
): Promise<boolean> => {
  try {
    console.log("=== Transaction and Signature Verification ===");
    
    // 1. Parse the unsigned transaction
    const tx = ethers.Transaction.from(unsignedTransactionSerialized);
    console.log("Parsed transaction:");
    console.log("  Chain ID:", tx.chainId);
    console.log("  Nonce:", tx.nonce);
    console.log("  To:", tx.to);
    console.log("  Value:", ethers.formatEther(tx.value), "ETH");
    console.log("  Gas Limit:", tx.gasLimit.toString());
    console.log("  Max Fee Per Gas:", tx.maxFeePerGas?.toString());
    console.log("  Max Priority Fee Per Gas:", tx.maxPriorityFeePerGas?.toString());
    console.log("  Type:", tx.type);
    
    // 2. Get the unsigned hash (message hash that should have been signed)
    const messageHash = tx.unsignedHash;
    console.log("Unsigned transaction hash:", messageHash);
    
    // 3. Parse the signature
    const sig = ethers.Signature.from(signature);
    console.log("Signature components:");
    console.log("  r:", sig.r);
    console.log("  s:", sig.s);
    console.log("  v:", sig.v);
    console.log("  yParity:", sig.yParity);
    
    // 4. Recover the public key and address from signature
    const recoveredPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, sig);
    const recoveredAddress = ethers.computeAddress(recoveredPublicKey);
    
    console.log("Expected address:", expectedAddress);
    console.log("Recovered address:", recoveredAddress);
    
    // 5. Check if addresses match (case-insensitive)
    const isValid = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    console.log("Signature is valid:", isValid);
    
    // 6. Additional verification using SigningKey static method
    try {
      const altRecoveredPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, sig);
      const altRecoveredAddress = ethers.computeAddress(altRecoveredPublicKey);
      console.log("Alternative recovered address:", altRecoveredAddress);
      console.log("Alternative verification matches:", altRecoveredAddress.toLowerCase() === expectedAddress.toLowerCase());
    } catch (error) {
      console.log("Alternative verification failed:", error.message);
    }
    
    console.log("===============================================");
    return isValid;
    
  } catch (error) {
    console.error("Error verifying transaction and signature:", error);
    return false;
  }
};


const broadcastTransaction = async (signature, unsignedTransactionSerialized) => {
  try {
    const resp = await axios.post(`https://api.figment.io/ethereum/broadcast`, {
      network: "hoodi",
      signature: signature,
      unsigned_transaction_serialized: unsignedTransactionSerialized
    },
    { headers });
    
    return resp.data.data.transaction_hash
  } catch (e) {
    console.error("Broadcast Transaction Error:")
    console.error(JSON.stringify(e.response?.data || e.message, null, 2));
    
  }
}


async function main() {
  // Send a POST request to the Figment API to create a new validator
  let response = null;;
  try {
    response = await axios.post(url, data, { headers });
  } catch (error) {
    console.error("Error creating validator:", JSON.stringify(error.response?.data || error.message, null, 2));
    return;
  }
  const responseJson = response.data;

  // boradcast with unsignedTransactionSerialized + signature parameters
  let unsignedTransactionSerialized =
    responseJson?.meta?.staking_transaction?.unsigned_transaction_serialized;
  if (!unsignedTransactionSerialized) {
    throw new Error("unsigned_transaction_serialized not found in the response");
  }
  console.log(`Unsigned transaction serialized: ${unsignedTransactionSerialized}`);

  let signature = await generateSignatureFromUnsignedTx(unsignedTransactionSerialized, privateKey);

  const isValidSignature = await verifyTransactionAndSignature(unsignedTransactionSerialized, signature, withdrawalAddress);
  console.log("Is the signature valid?", isValidSignature);
  const txHash = await broadcastTransaction(signature, unsignedTransactionSerialized)


  console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${txHash}`)

}

main().catch(console.error);