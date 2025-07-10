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
    
    // /console.log(e.response.data.error.details);
  }
}

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


async function main() {

  let amount = 0.0001;
  let pubKey = process.env.VALIDATOR_PUBKEY;

  let unsignedTransactionSerialized = await generatePartialWithdarawalTx(amount, pubKey);
  
  const wallet = new ethers.Wallet(privateKey);
  const unsignedTransaction = ethers.Transaction.from(unsignedTransactionSerialized);
  const signedTransaction = await wallet.signTransaction(unsignedTransaction);

  let txHash = "";
  txHash = await broadcastTransaction(signedTransaction);

  console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${txHash}`)

}

main().catch(console.error);