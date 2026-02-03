import { ethers } from "ethers";
import axios from "axios";
import { config } from "dotenv";
config();

// EIP-7002 Withdrawal Request Predeploy Address
const WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS = "0x00000961Ef480Eb55e80D19ad83579A64c007002";

// Load environment variables
const privateKey = process.env.PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL;

if (!privateKey || !rpcUrl) {
  throw new Error("Missing PRIVATE_KEY or RPC_URL in environment");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const apiKey = process.env.API_KEY;
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": apiKey, // Replace with your actual API key
};

async function buildUnsignedFullExitTxSerialized(
  validatorPubkey: string,    // 0x + 96 hex chars
  feeLimitWei?: bigint
) {

  // calldata: pubkey(48) + amount(8)=0 => full exit
  const amountBytes = ethers.toBeHex(0, 8);
  const data = validatorPubkey + amountBytes.slice(2);

  // current fee (must be paid as value)
  const feeData = await provider.call({ to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS, data: "0x" });
  const fee = ethers.getBigInt(feeData);
  if (feeLimitWei && fee > feeLimitWei) throw new Error(`Fee too high: ${fee} > ${feeLimitWei}`);

  const [net, nonce, feeInfo] = await Promise.all([
    provider.getNetwork(),
    provider.getTransactionCount(wallet.address),
    provider.getFeeData(),
  ]);

  // choose EIP-1559 when available
  const maxPriorityFeePerGas = feeInfo.maxPriorityFeePerGas ?? 1_500_000_000n;
  const maxFeePerGas = feeInfo.maxFeePerGas ?? (feeInfo.gasPrice ?? 0n);

  const gasLimit = await provider.estimateGas({
    from: wallet.address,
    to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
    data,
    value: fee,
  });

  const txRequest = {
    type: 2,
    chainId: net.chainId,
    nonce,
    to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
    data,
    value: fee,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };

  const tx = ethers.Transaction.from(txRequest);
  return {
    unsigned_transaction_serialized: tx.unsignedSerialized,
    unsigned_transaction_hashed: tx.unsignedHash,
  };
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

    console.log(`broadcasted transaction. explorer link: https://hoodi.etherscan.io/tx/${resp.data.data.transaction_hash}`)
    
    return resp.data.data.transaction_hash
  } catch (e) {
    console.error("Broadcast Transaction Error:")
    console.error(JSON.stringify(e.response?.data || e.message, null, 2));
  }
}


/**
 * Main function to demonstrate exit request
 */
async function main() {
  try {
    console.log("=== EIP-7002 Exit Request Demo ===");
    const validatorPubkey = process.env.EXIT_PUBKEY || "";
    const unsignedTransaction = await buildUnsignedFullExitTxSerialized(validatorPubkey);
    console.log('unsignedTransaction: ', unsignedTransaction);
    const signedTransaction = await signTransaction(unsignedTransaction.unsigned_transaction_serialized, privateKey);
    console.log('signedTransaction: ', signedTransaction);
    await broadcastTransaction(signedTransaction);
    
  } catch (error) {
    console.error("❌ Main function error:", error);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
