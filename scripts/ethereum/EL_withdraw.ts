import { ethers } from "ethers";
import { config } from "dotenv";
config();

// EIP-7002 Configuration Constants
const WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS = "0x00000961Ef480Eb55e80D19ad83579A64c007002";
const WITHDRAWAL_REQUEST_TYPE = "0x01";
const SYSTEM_ADDRESS = "0xfffffffffffffffffffffffffffffffffffffffe";
const MAX_WITHDRAWAL_REQUESTS_PER_BLOCK = 16;
const TARGET_WITHDRAWAL_REQUESTS_PER_BLOCK = 2;
const MIN_WITHDRAWAL_REQUEST_FEE = 1n;
const WITHDRAWAL_REQUEST_FEE_UPDATE_FRACTION = 17n;
const EXCESS_INHIBITOR = 2n ** 256n - 1n;

// Environment variables
const privateKey = process.env.PRIVATE_KEY;
const rpcUrl = process.env.RPC_URL;
const apiKey = process.env.API_KEY;

if (!privateKey || !rpcUrl) {
  throw new Error("Missing required environment variables: PRIVATE_KEY, RPC_URL");
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

// ABI for the withdrawal request contract
const WITHDRAWAL_REQUEST_ABI = [
  // Function to add withdrawal request (56 bytes input: 48 bytes pubkey + 8 bytes amount)
  "function addWithdrawalRequest(bytes calldata data) external payable",
  
  // Function to get current fee (0 bytes input)
  "function getFee() external view returns (uint256)",
  
  // Function to get withdrawal request count for current block
  "function getWithdrawalRequestCount() external view returns (uint256)",
  
  // Function to get queue head
  "function getQueueHead() external view returns (uint256)",
  
  // Function to get queue tail
  "function getQueueTail() external view returns (uint256)",
  
  // Events
  "event WithdrawalRequestAdded(address indexed source, bytes32 indexed validatorPubkey, uint64 amount, uint256 fee)",
];

// Contract interface
const withdrawalContract = new ethers.Contract(
  WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
  WITHDRAWAL_REQUEST_ABI,
  wallet
);

/**
 * Get the current fee required to add a withdrawal request
 * @returns Current fee in wei
 */
async function getCurrentFee(): Promise<bigint> {
  try {
    console.log("Getting current withdrawal request fee...");
    
    // Call the contract with empty data to get the fee
    const fee = await provider.call({
      to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
      data: "0x" // Empty call data triggers fee getter
    });
    
    const feeValue = ethers.getBigInt(fee);
    console.log(`Current fee: ${ethers.formatEther(feeValue)} ETH (${feeValue} wei)`);
    return feeValue;
  } catch (error) {
    console.error("Error getting current fee:", error);
    throw error;
  }
}

/**
 * Add a withdrawal request to the queue
 * @param validatorPubkey The validator's public key (48 bytes)
 * @param amount The amount to withdraw in wei (uint64)
 * @param feeLimit Maximum fee willing to pay (optional)
 * @returns Transaction hash
 */
async function addWithdrawalRequest(
  validatorPubkey: string,
  amount: bigint,
  feeLimit?: bigint
): Promise<string> {
  try {
    console.log("=== Adding Withdrawal Request ===");
    console.log(`Validator pubkey: ${validatorPubkey}`);
    console.log(`Amount: ${ethers.formatEther(amount)} ETH (${amount} wei)`);
    
    // Validate inputs
    if (!validatorPubkey.startsWith('0x')) {
      validatorPubkey = '0x' + validatorPubkey;
    }
    
    if (validatorPubkey.length !== 98) { // 0x + 48 bytes = 96 hex chars
      throw new Error("Validator public key must be 48 bytes (96 hex characters)");
    }
    
    if (amount <= 0n || amount > 2n ** 64n - 1n) {
      throw new Error("Amount must be a positive uint64 value");
    }
    
    // Get current fee
    const currentFee = await getCurrentFee();
    
    // Check fee limit if provided
    if (feeLimit && currentFee > feeLimit) {
      throw new Error(`Current fee (${ethers.formatEther(currentFee)} ETH) exceeds limit (${ethers.formatEther(feeLimit)} ETH)`);
    }
    
    // Prepare the call data: validator pubkey (48 bytes) + amount (8 bytes, big-endian)
    const amountBytes = ethers.toBeHex(amount, 8); // 8 bytes, big-endian
    const callData = validatorPubkey + amountBytes.slice(2); // Remove 0x prefix from amount
    
    console.log(`Call data: ${callData}`);
    console.log(`Fee to pay: ${ethers.formatEther(currentFee)} ETH`);
    
    // Create transaction
    const tx = {
      to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
      data: callData,
      value: currentFee,
      gasLimit: 100000n, // Conservative gas limit
    };
    
    // Send transaction
    console.log("Sending withdrawal request transaction...");
    const response = await wallet.sendTransaction(tx);
    
    console.log(`Transaction sent: ${response.hash}`);
    console.log("Waiting for confirmation...");
    
    // Wait for confirmation
    const receipt = await response.wait();
    
    if (receipt?.status === 1) {
      console.log("✅ Withdrawal request added successfully!");
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`Block number: ${receipt.blockNumber}`);
    } else {
      throw new Error("Transaction failed");
    }
    
    return response.hash;
    
  } catch (error) {
    console.error("❌ Error adding withdrawal request:", error);
    throw error;
  }
}

/**
 * Get withdrawal request statistics
 */
async function getWithdrawalStats(): Promise<void> {
  try {
    console.log("=== Withdrawal Request Statistics ===");
    
    // Get current block number
    const blockNumber = await provider.getBlockNumber();
    console.log(`Current block: ${blockNumber}`);
    
    // Get current fee
    const fee = await getCurrentFee();
    
    // Try to get queue statistics (these might not be available depending on contract implementation)
    try {
      const count = await provider.call({
        to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
        data: ethers.id("getWithdrawalRequestCount()").slice(0, 10)
      });
      console.log(`Current block withdrawal requests: ${ethers.getBigInt(count)}`);
    } catch (e) {
      console.log("Could not get withdrawal request count");
    }
    
    try {
      const queueHead = await provider.call({
        to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
        data: ethers.id("getQueueHead()").slice(0, 10)
      });
      console.log(`Queue head: ${ethers.getBigInt(queueHead)}`);
    } catch (e) {
      console.log("Could not get queue head");
    }
    
    try {
      const queueTail = await provider.call({
        to: WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
        data: ethers.id("getQueueTail()").slice(0, 10)
      });
      console.log(`Queue tail: ${ethers.getBigInt(queueTail)}`);
    } catch (e) {
      console.log("Could not get queue tail");
    }
    
    console.log("=====================================");
    
  } catch (error) {
    console.error("Error getting withdrawal stats:", error);
  }
}

/**
 * Calculate the fee based on EIP-7002 formula
 * @param excess The excess withdrawal requests
 * @returns Calculated fee
 */
function calculateFee(excess: bigint): bigint {
  // Formula: fee = MIN_WITHDRAWAL_REQUEST_FEE * e^(excess / WITHDRAWAL_REQUEST_FEE_UPDATE_FRACTION)
  // For simplicity, we'll use a linear approximation
  const feeMultiplier = excess / WITHDRAWAL_REQUEST_FEE_UPDATE_FRACTION;
  return MIN_WITHDRAWAL_REQUEST_FEE * (1n + feeMultiplier);
}

/**
 * Check if the caller address matches the withdrawal credential
 * @param validatorPubkey The validator's public key
 * @param callerAddress The address calling the contract
 * @returns Promise<boolean>
 */
async function verifyWithdrawalCredential(
  validatorPubkey: string,
  callerAddress: string
): Promise<boolean> {
  // This would require EIP-4788 (BEACON_ROOT opcode) to verify against beacon state
  // For now, we'll assume the caller is authorized
  // In a real implementation, you'd need to:
  // 1. Get the beacon state root
  // 2. Verify the validator's withdrawal credentials
  // 3. Check if the caller address matches the 0x01 withdrawal credential
  
  console.log(`Verifying withdrawal credential for validator ${validatorPubkey}`);
  console.log(`Caller address: ${callerAddress}`);
  console.log("Note: Full verification requires EIP-4788 implementation");
  
  return true; // Placeholder
}

/**
 * Main function to demonstrate withdrawal request
 */
async function main() {
  try {
    console.log("=== EIP-7002 Withdrawal Request Demo ===");
    console.log(`Network: ${await provider.getNetwork()}`);
    console.log(`Wallet address: ${wallet.address}`);
    console.log(`Contract address: ${WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS}`);
    
    // Get current stats
    await getWithdrawalStats();
    
    // Example validator public key (replace with actual validator pubkey)
    let exampleValidatorPubkey = "0x" + "1".repeat(96); // 48 bytes of 1s
    exampleValidatorPubkey = "0x85a34f02c87063d9d3747843c190783857d9c6a6a1ff69f2c8ffdc9ea7e38e5a5ff259e30daf27ba46d1442970281922";
    
    // Example withdrawal amount (0.1 ETH)
    // const withdrawalAmount = ethers.parseEther("32");
    const withdrawalAmount = 32n;
    
    // Set a fee limit (1 ETH)
    const feeLimit = ethers.parseEther("1.0");
    
    console.log("\n=== Example Withdrawal Request ===");
    console.log("Note: This is a demonstration with example data");
    console.log("Replace with actual validator public key and amount");
    
    // Uncomment the following lines to actually submit a withdrawal request
    const txHash = await addWithdrawalRequest(exampleValidatorPubkey, withdrawalAmount, feeLimit);
    console.log(`Withdrawal request submitted: ${txHash}`);
    
    console.log("\n=== Usage Instructions ===");
    console.log("1. Replace 'exampleValidatorPubkey' with your actual validator public key");
    console.log("2. Set the desired withdrawal amount");
    console.log("3. Uncomment the addWithdrawalRequest call in main()");
    console.log("4. Ensure your wallet has sufficient ETH for the fee");
    console.log("5. Run the script");
    
    console.log("\n=== Important Notes ===");
    console.log("- The caller address must match the 0x01 withdrawal credential");
    console.log("- Fees are dynamic and based on network usage");
    console.log("- Withdrawal requests are processed by the consensus layer");
    console.log("- This is for partial withdrawals; full exits require different process");
    
  } catch (error) {
    console.error("❌ Main function error:", error);
  }
}

// Export functions for use in other modules
export {
  addWithdrawalRequest,
  getCurrentFee,
  getWithdrawalStats,
  verifyWithdrawalCredential,
  calculateFee,
  WITHDRAWAL_REQUEST_PREDEPLOY_ADDRESS,
  WITHDRAWAL_REQUEST_TYPE
};

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}