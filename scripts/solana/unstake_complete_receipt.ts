import {
    Transaction,
    Keypair,
    PublicKey,
    Connection,
    clusterApiUrl,
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import { config } from "dotenv";
config();


const validatorVoteAccount = process.env.SOL_VOTE_ACCOUNT;
const fundingAccount = process.env.SOL_FUNDING_ACCOUNT;
const stakeAccount = process.env.SOL_STAKE_ACCOUNT;
const API_KEY = process.env.API_KEY; // Replace with your actual API key

async function createUnstakeTransaction(stakeAccount: string) {
    const API_URL = 'https://api.figment.io/solana/undelegate';
    // Define request body parameters
    const requestBody = {
        network: "devnet",
        stake_account: stakeAccount
    };

    try {
        const response = await axios.post(API_URL, requestBody, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        console.log('Response:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

async function createWithdrawalTransaction(stakeAccount: string, recipient_account: string, withdrawAmount: number) {
    const API_URL = 'https://api.figment.io/solana/withdraw';
    // Define request body parameters
    const requestBody = {
        network: "devnet",
        stake_account: stakeAccount,
        recipient_account: recipient_account,
        amount_sol: withdrawAmount
    };

    try {
        const response = await axios.post(API_URL, requestBody, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        console.log('Response:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

async function getAccountBalance(account: string) {
    const connection = new Connection(clusterApiUrl('devnet'));
    const lamports = await connection.getBalance(new PublicKey(account));
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log('Balance:', `${lamports} lamports (${sol} SOL)`);
    return sol;
};

async function broadcast(transaction_payload: string) {
    const API_URL = 'https://api.figment.io/solana/broadcast';
    // Define request body parameters
    const requestBody = {
        network: "devnet",
        transaction_payload: transaction_payload
    };

    try {
        const response = await axios.post(API_URL, requestBody, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

async function getStakes(network: string = "devnet") {
    const API_URL = 'https://api.figment.io/solana/stakes';

    try {
        const response = await axios.get(API_URL, {
            params: {
                network: network
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}


async function checkInactiveStakes(targetStakeAccount: string, maxChecks: number = 100, intervalMinutes: number = 10) {
    console.log(`🔍 Starting periodic check for inactive stakes...`);
    console.log(`📊 Target stake account: ${targetStakeAccount}`);
    console.log(`⏰ Check interval: ${intervalMinutes} minutes`);
    console.log(`🔄 Max checks: ${maxChecks}`);
    console.log(`⏳ Total duration: ${(maxChecks * intervalMinutes) / 60} hours\n`);

    let checkCount = 0;
    let inactiveFound = false;

    while (checkCount < maxChecks && !inactiveFound) {
        checkCount++;
        const currentTime = new Date().toLocaleString();

        console.log(`\n�� Check ${checkCount}/${maxChecks} - ${currentTime}`);
        console.log('='.repeat(50));

        try {
            const response = await getStakes();

            if (!response || !response.data) {
                console.log('❌ No stakes data found');
                continue;
            }

            // Filter for the specific stake account
            const targetStakes = response.data.filter((stake: any) =>
                stake.stake_account === targetStakeAccount
            );

            if (targetStakes.length === 0) {
                console.log(`❌ No stakes found for account: ${targetStakeAccount}`);
            } else {
                console.log(`✅ Found ${targetStakes.length} stake(s) for account: ${targetStakeAccount}`);

                // Check each stake for inactive status
                targetStakes.forEach((stake: any, index: number) => {
                    console.log(`\n📊 Stake ${index + 1}:`);
                    console.log(`   ID: ${stake.id}`);
                    console.log(`   Status: ${stake.status}`);
                    console.log(`   Balance: ${stake.balance} SOL`);
                    console.log(`   Active Balance: ${stake.active_balance} SOL`);
                    console.log(`   Inactive Balance: ${stake.inactive_balance} SOL`);

                    if (stake.status === 'inactive') {
                        console.log('🎯 *** INACTIVE STAKE FOUND! ***');
                        inactiveFound = true;
                    }
                });
            }

            // If we found an inactive stake, break the loop
            if (inactiveFound) {
                console.log('\n🎉 Inactive stake detected! Stopping periodic checks.');
                break;
            }

            // Wait for the next check (unless it's the last one)
            if (checkCount < maxChecks) {
                console.log(`\n⏳ Waiting ${intervalMinutes} minutes until next check...`);
                await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
            }

        } catch (error) {
            console.error(`❌ Error in check ${checkCount}:`, error.message);

            // Wait before retrying even on error
            if (checkCount < maxChecks) {
                console.log(`⏳ Waiting ${intervalMinutes} minutes before retry...`);
                await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
            }
        }
    }

    if (!inactiveFound) {
        console.log(`\n⏰ Periodic check completed after ${checkCount} attempts. No inactive stakes found.`);
    }

    return inactiveFound;
}

async function signTransaction(unsignedTransactionHex: string) {

    try {
        const privateKey = process.env.SOL_PRIVATE_KEY || "";
        const privateKeyBase58 = bs58.decode(privateKey);
        const wallet = Keypair.fromSecretKey(privateKeyBase58);

        // 1. Convert HEX transaction to Buffer
        const transactionBuffer = Buffer.from(unsignedTransactionHex, 'hex');

        // 2. Deserialize transaction
        const transaction = Transaction.from(transactionBuffer);

        // 3. Sign the transaction (add your signature)
        transaction.partialSign(wallet); // This adds your signature to the existing ones

        // 4. verify the signature status is all signed
        console.log("🔍 **Required Signers & Signatures:**");
        transaction.signatures.forEach((sig, index) => {
            const status = sig.signature ? "✅ Signed" : "❌ Missing";
            console.log(`${index + 1}. ${sig.publicKey.toBase58()} → ${status}`);
        });
        console.log('Verify Signature: ', transaction.verifySignatures());

        // 5. Serialize the fully signed transaction
        const fullySignedTransactionBuffer = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
        const fullySignedTransactionHex = fullySignedTransactionBuffer.toString('hex');
        return fullySignedTransactionHex;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

async function broadcastAndWaitForCompletion(
    transactionPayload: string,
    maxRetries: number = 30,
    retryDelay: number = 3000
): Promise<{ txHash: string, status: any, success: boolean }> {
    try {
        console.log('🚀 Broadcasting transaction...');

        // Step 1: Broadcast the transaction
        const broadcastResult = await broadcast(transactionPayload);

        if (!broadcastResult.transaction_hash) {
            throw new Error('Failed to get transaction hash from broadcast response');
        }

        const txHash = broadcastResult.transaction_hash;
        console.log('✅ Transaction broadcasted successfully!');
        console.log('�� Transaction Hash:', txHash);
        console.log('🔍 Waiting for transaction confirmation...');

        // Step 2: Wait for transaction completion with polling
        let attempts = 0;
        let finalStatus = null;

        while (attempts < maxRetries) {
            attempts++;
            console.log(`📊 Checking status (attempt ${attempts}/${maxRetries})...`);

            try {
                const statusResult = await getTxStatus(txHash);

                if (statusResult && statusResult.data) {
                    const status = statusResult.data;
                    console.log(`📈 Transaction Status: ${status.status || 'Unknown'}`);

                    // Check if transaction is confirmed/finalized
                    if (status.status === 'confirmed' || status.status === 'finalized' || status.status === 'success') {
                        console.log('🎉 Transaction confirmed successfully!');
                        finalStatus = status;
                        break;
                    } else if (status.status === 'failed' || status.status === 'error') {
                        console.log('❌ Transaction failed!');
                        finalStatus = status;
                        break;
                    }
                }

                // Wait before next check
                if (attempts < maxRetries) {
                    console.log(`⏳ Waiting ${retryDelay}ms before next check...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }

            } catch (statusError) {
                console.log(`⚠️ Status check failed (attempt ${attempts}):`, statusError.message);

                // If it's the last attempt, don't wait
                if (attempts < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }

        // Step 3: Return final result
        if (finalStatus) {
            const success = finalStatus.status === 'confirmed' || finalStatus.status === 'finalized' || finalStatus.status === 'success';
            return {
                txHash,
                status: finalStatus,
                success
            };
        } else {
            console.log('⏰ Transaction status check timed out after maximum retries');
            return {
                txHash,
                status: { status: 'timeout', message: 'Status check timed out' },
                success: false
            };
        }

    } catch (error) {
        console.error('❌ Error in broadcastAndWaitForCompletion:', error);
        throw error;
    }
}

async function getTxStatus(txHash: string) {
    const API_URL = 'https://api.figment.io/solana/tx';

    try {
        console.log('Getting transaction status for:', txHash);
        const response = await axios.get(API_URL, {
            params: {
                network: "devnet",
                hash: txHash
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};


async function main() {
    try {
        // generate stake payload
        let response = await createUnstakeTransaction(stakeAccount);
        console.log('Response:', response);
        let unsignedTransactionHex = response.data.unsigned_transaction_serialized;
        console.log('Unsigned Transaction:', unsignedTransactionHex);

        // sign transaction
        let fullySignedTransactionHex = await signTransaction(unsignedTransactionHex);
        console.log('Fully Signed Transaction:', fullySignedTransactionHex);

        // broadcast transaction
        let result = await broadcastAndWaitForCompletion(fullySignedTransactionHex);
        console.log('Response:', result);

        // Start periodic check for inactive stakes
        await checkInactiveStakes(stakeAccount, 10000, 1);


        // generate withdrawal payload
        let balance = await getAccountBalance(stakeAccount);
        let response2 = await createWithdrawalTransaction(stakeAccount, fundingAccount, balance);
        let unsignedTransactionHex2 = response2.data.unsigned_transaction_serialized;
        console.log('Unsigned Transaction:', unsignedTransactionHex2);

        // sign transaction
        let fullySignedTransactionHex2 = await signTransaction(unsignedTransactionHex2);
        console.log('Fully Signed Transaction:', fullySignedTransactionHex2);

        // broadcast transaction
        let result2 = await broadcastAndWaitForCompletion(fullySignedTransactionHex2);
        console.log('Response:', result2);

    } catch (error) {
        console.error("❌ Error broadcasting transaction:", error);
    }
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });