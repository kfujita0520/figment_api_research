import axios from "axios";
import fs from "fs";
import { FireblocksSDK, PeerType, TransactionOperation } from "fireblocks-sdk";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { config } from "dotenv";
config();


const figment_apiKey = process.env.API_KEY; // Replace with your actual API key

const fireblocks_apiSecret = fs.readFileSync("./credentials/fireblocks_secret.key", "utf8");
const fireblocks_apiKey = process.env.FIREBLOCKS_API_KEY;
const fireblocks = new FireblocksSDK(fireblocks_apiSecret, fireblocks_apiKey);

const network = process.env.NETWORK || "preprod";
const vaultAccountId = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS;

const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY;
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

  // Convert signatures
  const witnesses = await convertSignatures(signedMessages);

  // You can now embed these signatures into your Cardano transaction
  return witnesses;

}

async function convertSignatures(signedMessages) {
  console.log('Converting signatures to VkeyWitnesses...');

  const CSL = await import('@emurgo/cardano-serialization-lib-nodejs');

  const witnesses: string[] = [];
  
  for (const msg of signedMessages) {
    // Create public key from hex string
    const key = CSL.PublicKey.from_hex(msg.publicKey);
    
    // Create Vkey from public key
    const vkey = CSL.Vkey.new(key);
    
    // Create Ed25519 signature from hex string
    const sig = CSL.Ed25519Signature.from_hex(msg.signature.fullSig);
    
    // Create VkeyWitness from vkey and signature
    const witness = CSL.Vkeywitness.new(vkey, sig);
    
    // Convert witness to hex string
    const witnessHex = Buffer.from(witness.to_bytes()).toString('hex');
    
    witnesses.push(witnessHex);
    
    console.log(`Witness created for publicKey: ${msg.publicKey}`);
  }

  return witnesses;
}

async function broadcastTransaction(unsignedTx, signatures) {
  console.log('Broadcasting transaction to Cardano network...');
  try {

    const response = await axios.post(
      'https://api.figment.io/cardano/broadcast',
      {
        network: "preprod",
        unsigned_transaction_serialized: unsignedTx,
        signatures: signatures
      },
      { headers }
    );

    console.log('Transaction broadcasted successfully!');
    console.log('Transaction Hash:', response.data);
    
    return response.data;
  } catch (e) {
    console.error("Broadcast Transaction Error:")
    console.error(JSON.stringify(e.response?.data || e, null, 2));
  }
}

// const broadcastTransaction = async (signedTransaction: string) => {
//   try {
//     const resp = await axios.post(`https://api.figment.io/cardano/broadcast`, {
//       network: "perprod",
//       signed_transaction: signedTransaction
//     },
//       { headers });

//     return resp.data.data.transaction_hash
//   } catch (e) {
//     console.error("Broadcast Transaction Error:")
//     console.error(JSON.stringify(e.response?.data || e, null, 2));
//   }
// }

function getBodyHashHex(unsignedTxHex: string): string {
  // Parse the unsigned transaction to get the body
  const tx = CSL.Transaction.from_hex(unsignedTxHex);
  const txBody = tx.body();
  
  // Create FixedTransaction from body bytes to get access to transaction_hash()
  const fixedTx = CSL.FixedTransaction.new_from_body_bytes(txBody.to_bytes());
  
  return fixedTx.transaction_hash().to_hex();
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
  const sig = CSL.Ed25519Signature.from_bytes(Buffer.from(sigHex, "hex"));
  
  const isValid = verifySignature(unsignedTx, pubKeyHex, sigHex);
  if (!isValid) {
    console.warn("Signature verification failed for key:", pubKeyHex);
  }
  
  return CSL.Vkeywitness.new(vkey, sig);
}

function verifySignature(unsignedTxHex: string, pubKeyHex: string, sigHex: string): boolean {
  try {
      // 1. Parse the unsigned transaction
      const tx = CSL.Transaction.from_hex(unsignedTxHex);

      // 2. Get the transaction body hash (this is what should be signed)
      const txBody = tx.body();
      const fixedTx = CSL.FixedTransaction.new_from_body_bytes(txBody.to_bytes());
      const bodyHash = fixedTx.transaction_hash().to_hex();

      // 3. Convert signature to Ed25519Signature
      const signature = CSL.Ed25519Signature.from_hex(sigHex);

      // 4. Convert public key
      const publicKey = CSL.PublicKey.from_hex(pubKeyHex);

      // 5. Verify signature against the body hash
      const isValid = publicKey.verify(Buffer.from(bodyHash, "hex"), signature);

      console.log("Body hash:", bodyHash);
      console.log("Signature valid:", isValid);

      return isValid;
  } catch (error) {
      console.error("Verification error:", error);
      return false;
  }
}


async function submitToBlockfrost(cborBytes: Uint8Array) {
  const url = "https://cardano-preprod.blockfrost.io/api/v0/tx/submit";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "project_id": BLOCKFROST_API_KEY,
      "Content-Type": "application/cbor",
    },
    body: Buffer.from(cborBytes),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Submit failed ${res.status}: ${text}`);

  console.log("Tx hash: ", text.trim());
  return text.trim(); // tx hash
}


async function main() {
  const vaultAddresses = await fireblocks.getDepositAddresses(vaultAccountId, network === "mainnet" ? "ADA" : "ADA_TEST");
  const delegatorAddress = vaultAddresses[0].address;

  // Generate staking transaction
  let { unsigned_transaction_serialized, signing_payload } = await generateStakeTx(delegatorAddress, poolId);

  // signing_payload = "fe67928b299a50403c59d6bad193ffbdeb18d65c25d4ec9035aa99f738004323";

  // Generate signature from the signing_payload
  const witnesses = await signCardanoTxWithFireblocks(signing_payload);  
  
  // Merge signed transaction
  // const signed = await mergeSignedTransaction(unsigned_transaction_serialized, paymentPubKey, paymentKeySig, stakingPubKey, stakingKeySig);
  // console.log("merged signed: ", signed.to_hex());
  
  // Broadcast transaction
  let txHash = await broadcastTransaction(unsigned_transaction_serialized, witnesses);
  // let txHash = await submitToBlockfrost(signed.to_bytes());
  
  console.log(`broadcasted transaction. TxHash: ${txHash}`)

}

main().catch(console.error);