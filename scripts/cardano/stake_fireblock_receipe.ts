import axios from "axios";
import fs from "fs";
import { FireblocksSDK, PeerType, TransactionOperation } from "fireblocks-sdk";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { config } from "dotenv";
config();

// Configuration
const figment_apiKey = process.env.API_KEY; // Replace with your actual API key
const fireblocks_apiSecret = fs.readFileSync("./credentials/fireblocks_secret.key", "utf8");
const fireblocks_apiKey = process.env.FIREBLOCKS_API_KEY;
const fireblocks = new FireblocksSDK(fireblocks_apiSecret, fireblocks_apiKey);


// User Inputs
const network = process.env.NETWORK || "preprod";
const vaultAccountId = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS;
const poolId = "pool13la5erny3srx9u4fz9tujtl2490350f89r4w4qjhk0vdjmuv78v";


// API request headers for the Figment API
const headers = {
  accept: "application/json",
  "content-type": "application/json",
  "x-api-key": figment_apiKey,
};


/**
 * Generate staking transaction from Figment API
 * @param data The staking request data
 * @returns Object containing unsigned_transaction_serialized and unsigned_transaction_hashed
 */
const generateStakeTx = async (delegator_address: string, poolId: string): Promise<{
  unsigned_transaction_serialized: string;
  signing_payload: string;
}> => {
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

async function signCardanoTxWithFireblocks(signing_payload: string) : Promise<any>{
  // 1. Create a RAW transaction for signing
  const txRes = await fireblocks.createTransaction({
      assetId: network === "mainnet" ? "ADA" : "ADA_TEST",
      source: { type: PeerType.VAULT_ACCOUNT, id: vaultAccountId },
      operation: TransactionOperation.RAW,
      extraParameters: {
          rawMessageData: {
              messages: [
                  { content: signing_payload }, // Payment key
                  { content: signing_payload, bip44change: 2 } // Staking key
              ]
          }
      },
      note: "Sign Cardano transaction"
  });

  console.log("Transaction created:", txRes.id);

  // 2. Wait for the transaction to be signed
  let tx;
  do {
      tx = await fireblocks.getTransactionById(txRes.id);
      if (!["CONFIRMED", "CANCELLED", "REJECTED", "FAILED"].includes(tx.status)) {
          console.log(`Waiting for signature... Current status: ${tx.status}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
      }
  } while (!["COMPLETED", "CONFIRMED", "CANCELLED", "REJECTED", "FAILED"].includes(tx.status));

  // 3. Extract signatures
  const signedMessages = tx.signedMessages;
  console.log("Signed Messages:", signedMessages);
  if (!signedMessages || signedMessages.length < 2) {
      throw new Error("Did not receive both payment and staking key signatures.");
  }

  const paymentKeySig = signedMessages[0].signature.fullSig;
  const stakingKeySig = signedMessages[1].signature.fullSig;
  const paymentPubKey = signedMessages[0].publicKey;
  const stakingPubKey = signedMessages[1].publicKey;

  console.log("Payment Key Signature:", paymentKeySig);
  console.log("Staking Key Signature:", stakingKeySig);
  console.log("Payment Public Key:", paymentPubKey);
  console.log("Staking Public Key:", stakingPubKey);

  // You can now embed these signatures into your Cardano transaction
  return { paymentKeySig, stakingKeySig, paymentPubKey, stakingPubKey };

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

async function mergeSignedTransaction(unsignedHex: string, 
  paymentPubKeyHex: string, paymentSignatureHex: string, 
  stakePubKeyHex: string, stakeSignatureHex: string // 32 bytes
) {
  try{
      console.log("start merge unsignedHex: ", unsignedHex);
      const tx = CSL.Transaction.from_hex(unsignedHex);
      console.log("tx: ", tx);

      const witnesses = CSL.TransactionWitnessSet.new();
      const vkeys = CSL.Vkeywitnesses.new();
      vkeys.add(vkeyWitnessFrom(paymentPubKeyHex, paymentSignatureHex, unsignedHex));
      vkeys.add(vkeyWitnessFrom(stakePubKeyHex, stakeSignatureHex, unsignedHex));
      witnesses.set_vkeys(vkeys);

      const signed = CSL.Transaction.new(tx.body(), witnesses, tx.auxiliary_data());
      return signed;
  } catch (error) {
      console.error("Error submitting:", error);
      throw error;
  }
  
}

function vkeyWitnessFrom(pubKeyHex: string, sigHex: string, unsignedTx: string) {   

  const vkey = CSL.Vkey.new(CSL.PublicKey.from_hex(pubKeyHex));
  const sig = CSL.Ed25519Signature.from_hex(sigHex);
  
  return CSL.Vkeywitness.new(vkey, sig);
}


async function main() {
  const vaultAddresses = await fireblocks.getDepositAddresses(vaultAccountId, network === "mainnet" ? "ADA" : "ADA_TEST");
  const delegatorAddress = vaultAddresses[0].address;

  // Generate staking transaction
  let { unsigned_transaction_serialized, signing_payload } = await generateStakeTx(delegatorAddress, poolId);

  // Generate signature from the signing_payload
  const { paymentKeySig, stakingKeySig, paymentPubKey, stakingPubKey } = await signCardanoTxWithFireblocks(signing_payload);  
  
  // Merge signed transaction
  const signed = await mergeSignedTransaction(unsigned_transaction_serialized, paymentPubKey, paymentKeySig, stakingPubKey, stakingKeySig);
  console.log("merged signed: ", signed.to_hex());
  
  // Broadcast transaction
  let txHash = await broadcastTransaction(signed.to_hex());
  
  console.log(`broadcasted transaction. TxHash: ${txHash}`)

}

main().catch(console.error);