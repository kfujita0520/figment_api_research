import axios from "axios";
import { ethers } from "ethers";
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
  withdrawal_address: withdrawalAddress,
  funding_address: withdrawalAddress,
  fee_recipient_address: withdrawalAddress,
  region: "ca-central-1",
  credentials_prefix: '0x02',
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
    console.log(e.response);
    console.log(e.response.data.error.details);
  }
}

/**
 * Broadcast an Ethereum transaction using ethers.js with an RPC provider
 * @param signature The signature generated from the unsigned transaction hash
 * @param unsignedTransactionSerialized The unsigned transaction data
 * @returns Transaction hash
 */
const broadcastWithEthers = async (signature: string, unsignedTransactionSerialized: string): Promise<string> => {
  try {
    // Convert signature to r, s, v components
    const sig = ethers.Signature.from(signature);
    console.log("Signature components:", sig);
    
    // Parse the transaction data
    const tx = ethers.Transaction.from(unsignedTransactionSerialized);
    
    
    // Create signed transaction by adding the signature components
    const unsignedTx = tx.unsignedSerialized;
    console.log("Signed transaction:", unsignedTx);

    const wallet = new ethers.Wallet(privateKey, provider);
    const txRequest = {
      to: tx.to,
      from: wallet.address,
      nonce: tx.nonce,
      gasLimit: tx.gasLimit,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      maxFeePerGas: tx.maxFeePerGas,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
      type: tx.type || 0
    };
    console.log("Transaction request:", txRequest);

    // Sign the transaction (creates a new transaction with your signature)
    const signedTx = await wallet.signTransaction(txRequest);
    console.log("Created signed transaction:", signedTx);
    
    // Send the raw transaction
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log("Transaction sent:", txResponse.hash);
    
    // Wait for transaction to be mined (optional)
    const receipt = await txResponse.wait();
    console.log("Transaction mined in block:", receipt?.blockNumber);
    
    return txResponse.hash;
  } catch (e) {
    console.error("Error broadcasting transaction:", e);
    throw e;
  }
};

async function main() {
  // Send a POST request to the Figment API to create a new validator
  const response = await axios.post(url, data, { headers });
  const responseJson = response.data;

  // Extract the unsigned transaction serialized part from the response
  const unsignedTransactionSerialized =
    responseJson?.meta?.staking_transaction?.unsigned_transaction_serialized;
  if (!unsignedTransactionSerialized) {
    throw new Error("unsigned_transaction_serialized not found in the response");
  }
  console.log(`Unsigned transaction serialized: ${unsignedTransactionSerialized}`);

  // Extract the unsigned transaction hashed part from the response
  const unsignedTransactionHashed =
    responseJson?.meta?.staking_transaction?.unsigned_transaction_hashed;
  if (!unsignedTransactionHashed) {
    throw new Error("unsigned_transaction_hashed not found in the response");
  }
  console.log(`Unsigned transaction hash: ${unsignedTransactionHashed}`);

  // Sign the transaction hash using the private key
  const wallet = new ethers.Wallet(privateKey, provider);
  // ethers expects a 0x-prefixed hex string for the hash
  const signature = await wallet.signMessage(ethers.getBytes(unsignedTransactionHashed));
  console.log(`Signature: ${signature}`);

//   const txHash = await broadcastTransaction(signature, unsignedTransactionSerialized)

  const txHash = await broadcastWithEthers(signature, unsignedTransactionSerialized)
  console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${txHash}`)

}

main().catch(console.error);