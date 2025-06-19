import axios from "axios";
import { ethers, SigningKey } from "ethers";
import { config } from "dotenv";
config();

// Your MetaMask private key (KEEP THIS SECRET)
const privateKey = process.env.PRIVATE_KEY; // Replace with your actual private key
const apiKey = process.env.API_KEY; // Replace with your actual API key

// API request details for the Figment API
const url = "https://api.figment.io/ethereum/validators";
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": apiKey, 
};
const withdrawalAddress = process.env.WITHDRAWAL_ADDRESS; // Replace with your actual withdrawal address
const data = {
  network: "hoodi",
  validators_count: 1,
  //amount: "32",
  withdrawal_address: withdrawalAddress,
  region: "ca-central-1",
  //credentials_prefix: '0x02',
};


/**
 * Generate signature for unsigned transaction hash using ethers.js v6
 * @param unsignedTransactionHash The unsigned transaction hash string
 * @param privateKey The private key to sign with (with or without 0x prefix)
 * @returns The signature hex string
 */
const generateSignatureFromUnsignedTxHash = async (
  unsignedTransactionHash: string,
  privateKey: string
): Promise<string> => {
  try {
    console.log("=== Generating Signature ===");
     
    // 1. Format private key (ensure 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    
    // 2. Create signing key and sign the hash
    const signingKey = new ethers.SigningKey(formattedPrivateKey);
    const signature = signingKey.sign(unsignedTransactionHash);
    
    console.log("Generated signature components:");
    console.log("  r:", signature.r);
    console.log("  s:", signature.s);
    console.log("  v:", signature.v);
    console.log("  yParity:", signature.yParity);
    console.log("  serialized:", signature.serialized);
    console.log("  compactSerialized:", signature.compactSerialized);
    
    // 3. Verify the signature we just generated
    const recoveredPublicKey = ethers.SigningKey.recoverPublicKey(unsignedTransactionHash, signature);
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

  let unsignedTransactionHash =
    responseJson?.meta?.staking_transaction?.unsigned_transaction_hashed;
  if (!unsignedTransactionHash) {
    throw new Error("unsigned_transaction_hashed not found in the response");
  }
  console.log(`Unsigned transaction hash: ${unsignedTransactionSerialized}`);

  console.log(JSON.stringify(responseJson, null, 2));

  //let signature = await generateSignatureFromUnsignedTx(unsignedTransactionSerialized, privateKey);
  let signature = await generateSignatureFromUnsignedTxHash(unsignedTransactionHash, privateKey);

  // const isValidSignature = await verifyTransactionAndSignature(unsignedTransactionSerialized, signature, withdrawalAddress);
  // console.log("Is the signature valid?", isValidSignature);
  
  let txHash = "";
  txHash = await broadcastTransaction(signature, unsignedTransactionSerialized)


  console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${txHash}`)

}

main().catch(console.error);