import { ethers } from "ethers";
import { config } from "dotenv";
config();

// Consolidation Contract address
const CONSOLIDATION_PREDEPLOY = "0x0000BBdDc7CE488642fb579F8B00f3a590007251";

// Environment variables
const privateKey = process.env.PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL;

if (!privateKey || !rpcUrl) {
  throw new Error("Missing required environment variables: PRIVATE_KEY, RPC_URL");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const signer = new ethers.Wallet(privateKey, provider);



function toBytes48(hex) {
  const b = ethers.getBytes(hex);
  if (b.length !== 48) throw new Error(`expected 48 bytes, got ${b.length}`);
  return b;
}

export async function requestConsolidation({
  sourcePubkeyHex48,    // 0x… 48 bytes
  targetPubkeyHex48,    // 0x… 48 bytes
  feeLimitWei           // safety cap to avoid overpaying
}) {

  // 1) Read current fee (empty calldata)
  const feeData = await provider.call({ to: CONSOLIDATION_PREDEPLOY, data: "0x" });
  const fee = BigInt(feeData);
  if (fee > BigInt(feeLimitWei)) {
    throw new Error(`Fee too high: ${fee} wei > limit ${feeLimitWei}`);
  }

  // 2) calldata = source_pubkey(48) || target_pubkey(48) => 96 bytes
  const data = ethers.concat([toBytes48(sourcePubkeyHex48), toBytes48(targetPubkeyHex48)]);

  // 3) Submit request paying EXACT fee (recommended by EIP)
  const tx = await signer.sendTransaction({
    to: CONSOLIDATION_PREDEPLOY,
    data,
    value: fee
  });

  console.log("sent:", tx.hash);
  await tx.wait();
  console.log("confirmed:", tx.hash);
}

/**
 * Main function to demonstrate withdrawal request
 */
async function main() {
  try {
    const sourcePubkeyHex = process.env.EXIT_PUBKEY;
    const destPubkeyHex = process.env.VALIDATOR_PUBKEY;
   
    if (!sourcePubkeyHex) throw new Error("Missing VALIDATOR_PUBKEY");
    if (!sourcePubkeyHex.startsWith("0x") || sourcePubkeyHex.length !== 98) {
      throw new Error("VALIDATOR_PUBKEY must be 0x + 96 hex chars (48 bytes)");
    }

    console.log("=== Consolidation Request ===");
    console.log(`Consolidation contract: ${CONSOLIDATION_PREDEPLOY}`);

    // Set a fee limit (1 ETH)
    const feeLimit = ethers.parseEther("1.0");

    await requestConsolidation({
      sourcePubkeyHex48: sourcePubkeyHex,
      targetPubkeyHex48: destPubkeyHex,
      feeLimitWei: feeLimit,
    });
    
  } catch (error) {
    console.error("❌ Main function error:", error);
  }
}


// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}