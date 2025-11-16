import { mnemonicToEntropy } from "bip39";
import axios from "axios";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { config } from "dotenv";
config();

// Configuration
const figment_apiKey = process.env.API_KEY; // Replace with your actual API key
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;

// User Inputs
const network = process.env.NETWORK || "preprod";
const poolId = process.env.POOL_ID;
const MNEMONIC = process.env.CARDANO_MNEMONIC;


// API request headers for the Figment API
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": figment_apiKey,
};

// Wallet derivation
const entropy = mnemonicToEntropy(MNEMONIC);
const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, "hex"),
    Buffer.from(""),
);

const accountKey = rootKey
    .derive(harden(1852)) // purpose
    .derive(harden(1815)) // coin type
    .derive(harden(0)); // account #0

const stakePrivKey = accountKey
    .derive(2) // chimeric
    .derive(0);

const paymentPrivKey = accountKey
    .derive(0) // external
    .derive(0);

const addr = CSL.BaseAddress.new(
    CSL.NetworkInfo.testnet_preprod().network_id(),
    CSL.Credential.from_keyhash(paymentPrivKey.to_public().to_raw_key().hash()),
    CSL.Credential.from_keyhash(stakePrivKey.to_public().to_raw_key().hash()),
);

  function harden(num: number): number {
    return 0x80000000 + num;
  }

    
  /**
   * Generate staking transaction from Figment API
   * @param data The staking request data
   * @returns Object containing unsigned_transaction_serialized and unsigned_transaction_hashed
   */
  async function generateStakeTx(delegator_address: string, poolId: string): Promise<{
    unsigned_transaction_serialized: string;
    signing_payload: string;
  }> {
    try {
      console.log("=== Generating Staking Transaction ===");
      console.log("delegator_address: ", delegator_address);
      console.log("poolId: ", poolId);
  
      const resp = await axios.post(`https://api.figment.io/cardano/delegate`, {
        network: "preprod",
        delegator_address: delegator_address,
        validator_address: poolId,
      }, { headers });
  
      const responseJson = resp.data;
  
      console.log("responseJson: ", responseJson);
  
      // Extract unsigned transaction serialized
      const unsigned_transaction_serialized = 
        responseJson?.data?.unsigned_transaction_serialized;
      if (!unsigned_transaction_serialized) {
        throw new Error("unsigned_transaction_serialized not found in the response");
      }
  
      // Extract unsigned transaction hashed
      const signing_payload = 
        responseJson?.data?.signing_payload;
      if (!signing_payload) {
        throw new Error("unsigned_transaction_hashed not found in the response");
      }
  
      console.log("✅ Successfully generated staking transaction");
      console.log("Unsigned transaction serialized:", unsigned_transaction_serialized);
      console.log("signing_payload:", signing_payload);
  
      return {
        unsigned_transaction_serialized,
        signing_payload
      };
  
    } catch (error) {
      console.error("❌ Error generating staking transaction:");
      if (error.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(error.message);
      }
      throw error;
    }
  };

  async function signTransaction(unsignedTransaction: string): Promise<string>{
    const tx = CSL.Transaction.from_hex(unsignedTransaction);
    const txBody = tx.body();
    const fixedTx = CSL.FixedTransaction.new_from_body_bytes(txBody.to_bytes());
    fixedTx.sign_and_add_vkey_signature(paymentPrivKey.to_raw_key());
    fixedTx.sign_and_add_vkey_signature(stakePrivKey.to_raw_key());
    return fixedTx.to_hex();
  }
  
  
  async function broadcastTransaction(signedTransaction: string){
    try {
      const resp = await axios.post(`https://api.figment.io/cardano/broadcast`, {
        network: "preprod",
        signed_transaction: signedTransaction
      },
        { headers });
  
      return resp.data.data.tx_hash
    } catch (e) {
      console.error("Broadcast Transaction Error:")
      console.error(JSON.stringify(e.response?.data || e, null, 2));
    }
  }
  
  async function main() {

    const delegatorAddress = addr.to_address();
    console.log("delegatorAddress: ", delegatorAddress.to_bech32());
  
    // Generate staking transaction
    let { unsigned_transaction_serialized, signing_payload } = await generateStakeTx(delegatorAddress.to_bech32(), poolId);
    
    // Get signed transaction hex
    const signedTxHex = await signTransaction(unsigned_transaction_serialized);
    console.log("signedTxHex: ", signedTxHex);
    
    // Broadcast transaction
    let txHash = await broadcastTransaction(signedTxHex);
    
    console.log(`broadcasted transaction. TxHash: ${txHash}`)
  
  }
  
  main().catch(console.error);