import axios from "axios";
import { ethers, SigningKey } from "ethers";
import { config } from "dotenv";
config();

// Your MetaMask private key (KEEP THIS SECRET)
const privateKey = process.env.PRIVATE_KEY; // Replace with your actual private key
const apiKey = process.env.API_KEY; // Replace with your actual API key

// API request headers for the Figment API
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": apiKey,
};
const withdrawalAddress = process.env.WITHDRAWAL_ADDRESS; // Replace with your actual withdrawal address

// Supposed to be user input
const withdrawAmount = 0.1;
const pubKey = process.env.VALIDATOR_PUBKEY;

const generatePartialWithdarawalTx = async (amount, pubKey) => {
  try {
    const resp = await axios.post(`https://api.figment.io/ethereum/withdrawal`, {
        network: "hoodi",
        amount: amount.toString(),
        pubkey: pubKey, 
      },
      { headers });

    return resp.data.data.unsigned_transaction_serialized
  } catch (e) {
    console.error("Withdrawal Transaction Error:")
    console.error(JSON.stringify(e.response?.data || e.message, null, 2));
  }
}

const signTransaction = async (unsignedTransactionSerialized, privateKey) => {
  let wallet = new ethers.Wallet(privateKey);
  let unsignedTransaction = ethers.Transaction.from(unsignedTransactionSerialized);
  return await wallet.signTransaction(unsignedTransaction);
}

const broadcastTransaction = async (signedTransaction) => {
  try {
    const resp = await axios.post(`https://api.figment.io/ethereum/broadcast`, {
      network: "hoodi",
      signed_transaction: signedTransaction
    },
    { headers });
    
    return resp.data.data.transaction_hash
  } catch (e) {
    console.error("Broadcast Transaction Error:")
    console.error(JSON.stringify(e.response?.data || e.message, null, 2));
  }
}

async function main() {

  let unsignedTransactionSerialized = await generatePartialWithdarawalTx(withdrawAmount, pubKey);
  
  let signedTransaction = await signTransaction(unsignedTransactionSerialized, privateKey);

  let txHash = await broadcastTransaction(signedTransaction);

  console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${txHash}`)

}

main().catch(console.error);