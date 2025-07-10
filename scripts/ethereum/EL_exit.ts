import { ethers } from "ethers";
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

async function getCurrentFee(): Promise<bigint> {
  const fee = await provider.call({
    to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
    data: "0x"
  });
  return ethers.getBigInt(fee);
}

/**
 * Submits a full exit (withdrawal) request for a validator.
 * @param validatorPubkey 48-byte validator pubkey as 0x-prefixed hex string
 * @param feeLimit Optional: maximum fee you're willing to pay (in wei)
 */
async function submitFullExit(
  validatorPubkey: string,
  feeLimit?: bigint
) {
  if (!validatorPubkey.startsWith("0x") || validatorPubkey.length !== 98) {
    throw new Error("Validator pubkey must be a 48-byte hex string (0x + 96 hex chars)");
  }

  // Prepare calldata: pubkey (48 bytes) + amount (8 bytes, big-endian)
  const amountBytes = ethers.toBeHex(0, 8); // When full exit, amount is 0
  const callData = validatorPubkey + amountBytes.slice(2);

  // Get the current fee
  const fee = await getCurrentFee();
  if (feeLimit && fee > feeLimit) {
    throw new Error(`Current fee (${ethers.formatEther(fee)} ETH) exceeds your limit (${ethers.formatEther(feeLimit)} ETH)`);
  }

  // Send the transaction
  const tx = await wallet.sendTransaction({
    to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
    data: callData,
    value: fee,
    gasLimit: 100_000n,
  });

  console.log(`Exit transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status === 1) {
    console.log("✅ Full exit request submitted successfully!");
  } else {
    throw new Error("❌ Transaction failed");
  }
}

// --- ENTRY POINT ---

if (require.main === module) {
  (async () => {
    try {
      const validatorPubkey = process.env.VALIDATOR_PUBKEY || "";
      // Optional: set a fee limit (in wei)
      // const feeLimit = ethers.parseEther("1.0");
      await submitFullExit(validatorPubkey /*, feeLimit */);
    } catch (err) {
      console.error(err);
    }
  })();
}