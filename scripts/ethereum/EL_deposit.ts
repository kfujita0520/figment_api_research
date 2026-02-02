import { ethers } from "ethers";
import { ContainerType, ByteVectorType, ByteListType, UintNumberType } from "@chainsafe/ssz";
import { config } from "dotenv";
config();

// Mainnet deposit contract
const DEPOSIT_CONTRACT = "0x00000000219ab540356cbb839cbe05303d7705fa";

const DEPOSIT_ABI = [
  "function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root) external payable"
];

// SSZ type for deposit data (as used by the consensus spec)
const DepositData = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8), // uint64
  signature: new ByteVectorType(96),
});

function toBytes(hex, len) {
  const b = ethers.getBytes(hex);
  if (b.length !== len) throw new Error(`expected ${len} bytes, got ${b.length}`);
  return b;
}

export async function topUpValidator({
  rpcUrl,
  privateKey,
  validatorPubkeyHex, // 0x + 96 hex chars (48 bytes)
  amountEth           // e.g. "1.5"
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  const pubkey = toBytes(validatorPubkeyHex, 48);

  // Launchpad-style top-up uses zeroed withdrawal_credentials and signature.  [oai_citation:7‡DeepWiki](https://deepwiki.com/ethereum/staking-launchpad/4.3-funds-top-up)
  const withdrawalCredentials = new Uint8Array(32); // all zeros
  const signature = new Uint8Array(96);             // all zeros

  const amountWei = ethers.parseEther(amountEth);
  const amountGwei = Number(amountWei / 1_000_000_000n); // uint64 gwei
  if (amountGwei < 1_000_000_000) throw new Error("Deposit contract min is 1 ETH");

  // Compute deposit_data_root = hash_tree_root(DepositData)
  const depositDataRoot = ethers.hexlify(
    DepositData.hashTreeRoot({
      pubkey,
      withdrawal_credentials: withdrawalCredentials,
      amount: amountGwei,
      signature
    })
  );

  const deposit = new ethers.Contract(DEPOSIT_CONTRACT, DEPOSIT_ABI, signer);

  const tx = await deposit.deposit(
    ethers.hexlify(pubkey),
    ethers.hexlify(withdrawalCredentials),
    ethers.hexlify(signature),
    depositDataRoot,
    { value: amountWei }
  );

  console.log("sent:", tx.hash);
  await tx.wait();
  console.log("confirmed:", tx.hash);
}

/**
 * Main function to demonstrate withdrawal request
 */
async function main() {
  try {
    //call topUpValidator 
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const validatorPubkeyHex = process.env.VALIDATOR_PUBKEY;
    const amountEth = process.env.DEPOSIT_AMOUNT_ETH ?? "1.0";

    if (!rpcUrl) throw new Error("Missing RPC_URL");
    if (!privateKey) throw new Error("Missing PRIVATE_KEY");
    if (!validatorPubkeyHex) throw new Error("Missing VALIDATOR_PUBKEY");
    if (!validatorPubkeyHex.startsWith("0x") || validatorPubkeyHex.length !== 98) {
      throw new Error("VALIDATOR_PUBKEY must be 0x + 96 hex chars (48 bytes)");
    }

    console.log("=== Deposit Top-up ===");
    console.log(`Deposit contract: ${DEPOSIT_CONTRACT}`);
    console.log(`Amount: ${amountEth} ETH`);

    await topUpValidator({
      rpcUrl,
      privateKey,
      validatorPubkeyHex,
      amountEth,
    });   
    
  } catch (error) {
    console.error("❌ Main function error:", error);
  }
}


// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}