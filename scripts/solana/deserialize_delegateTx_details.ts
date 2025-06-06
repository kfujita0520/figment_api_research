import {
  Message,
  PublicKey,
} from "@solana/web3.js";
import bs58 from 'bs58';
import * as borsh from "@coral-xyz/borsh";


// Define the borsh schema for SystemProgram's createAccount
const createAccountBorshSchema = borsh.struct([
  borsh.u32('instruction'),  // 0 = createAccount
  borsh.u64('lamports'),     // Amount of lamports to transfer
  borsh.u64('space'),        // Amount of space in bytes to allocate
  borsh.publicKey('programId'), // Program ID to assign as the owner
]);

// Define the borsh schema for SystemProgram's createAccount
const initializeStakeAccBorshSchema = borsh.struct([
  borsh.u32('instruction'),               // 0 = Initialize
  borsh.publicKey('authorizedStaker'),    // Staker's public key (32 bytes)
  borsh.publicKey('authorizedWithdrawer'),// Withdrawer's public key (32 bytes)
  borsh.i64('unixTimestamp'),             // Lockup expiry (Unix timestamp)
  borsh.u64('epoch'),                     // Lockup expiry (epoch)
  borsh.publicKey('custodian'),           // Custodian authority for early unlocking (32 bytes)
]);

// Define the Borsh schema for Compute Budget Program
const ComputeBudgetSchema = borsh.struct([
  borsh.u8("instruction"), // Instruction ID (Enum: 0 = SetComputeUnitLimit, 1 = SetComputeUnitPrice, etc.)
  borsh.u32("value"), // The compute unit limit or price
]);

// Define the borsh schema for StakeProgram's Delegate instruction
const stakeDelegateSchema = borsh.struct([
  borsh.u32('instruction'),  // 2 = Delegate stake
  // No additional fields - all necessary information is in the accounts array
]);

function deserializeProgramData(dataBase58: string, index: any) {
  if (index == 0) {
    // Deserialize the data
    const decodedData = deserializeCreateAccountData(dataBase58, createAccountBorshSchema);
    console.log('Instruction Type:', decodedData.instruction);
    console.log('Lamports:', decodedData.lamports.number, '(', decodedData.lamports.sol, 'SOL)');
    console.log('Space:', decodedData.space.number, 'bytes');
    console.log('Program ID:', decodedData.programId.base58);
  } else if(index == 1) {
    const decodedData = initializeStakeAccBorshSchema.decode(bs58.decode(dataBase58));
    // Print full object if needed
    console.log('\nFull decoded data:');
    console.log(JSON.stringify(decodedData, (key, value) => {
      // Convert BN objects to their string representation
      if (value && value.constructor && value.constructor.name === 'BN') {
        return value.toString(10);
      }
      return value;
    }, 2));
  } else if(index==2) {
    // Deserialize the instruction data
    const decodedData = ComputeBudgetSchema.decode(bs58.decode(dataBase58));
    console.log("Instruction ID:", decodedData.instruction);
    console.log("Value:", decodedData.value);
  } else if (index==3) {
    const decodedData = stakeDelegateSchema.decode(bs58.decode(dataBase58));
    console.log('Instruction Type:', decodedData.instruction);
    console.log('Instruction Name:', decodedData.instruction === 2 ? 'Delegate' : 'Unknown');
    
    console.log('\nAccount Roles:');
    console.log('1. Stake Account:     5hJxQNpLxE5drcCzNbRCbh38E4F8Dg2Nazf2e2T1e2dw');
    console.log('2. Vote Account:      GkqYQysEGmuL6V2AJoNnWZUz2ZBGWhzQXsJiXm2CLKAN');
    console.log('3. Clock Sysvar:      SysvarC1ock11111111111111111111111111111111');
    console.log('4. Stake History:     SysvarStakeHistory1111111111111111111111111');
    console.log('5. Stake Config:      StakeConfig11111111111111111111111111111111');
    console.log('6. Stake Authority:   7Dc8UevAZLTyehmuprb96pVuAmdcQh6hCdzVx7HBk4WA');

    // Print full object if needed
    console.log('\nFull decoded data:');
    console.log(JSON.stringify(decodedData, null, 2));
  }
} 

// Function to deserialize program data
function deserializeCreateAccountData(dataBase58: string, schema: any) {
  // Decode the base58 string to a buffer
  const buffer = bs58.decode(dataBase58);
  
  // Use the schema to decode the buffer
  const decodedData = schema.decode(buffer);
  
  // Convert BN values to normal numbers
  return {
    instruction: decodedData.instruction,
    lamports: {
      bn: decodedData.lamports,
      number: decodedData.lamports.toNumber(),
      sol: decodedData.lamports.toNumber() / 1_000_000_000, // Convert lamports to SOL
    },
    space: {
      bn: decodedData.space,
      number: decodedData.space.toNumber(),
    },
    programId: {
      publicKey: decodedData.programId,
      base58: decodedData.programId.toBase58(),
    }
  };
}



function deserializeTransactionData(serializedTx: string) {
  // Decode base64
  const messageBuffer = Buffer.from(serializedTx, 'hex');
  const message = Message.from(messageBuffer);
  console.log('\n=== Decoded Transaction Details ===');

  // Header info
  console.log('\nHeader:');
  console.log('numRequiredSignatures:', message.header.numRequiredSignatures);
  console.log('numReadonlySignedAccounts:', message.header.numReadonlySignedAccounts);
  console.log('numReadonlyUnsignedAccounts:', message.header.numReadonlyUnsignedAccounts);

  // Account keys
  console.log('\nAccount Keys:');
  message.accountKeys.forEach((pubkey, index) => {
    console.log(`[${index}] ${pubkey.toBase58()}`);
  });

  // Instructions
  console.log('\nInstructions:');
  message.instructions.forEach((ix, index) => {
    console.log(`\nInstruction ${index}:`);
    console.log('Program:', message.accountKeys[ix.programIdIndex].toBase58());
    console.log('Accounts:', ix.accounts.map(i => message.accountKeys[i].toBase58()));
    console.log('Data:', ix.data.toString());
    deserializeProgramData(ix.data.toString(), index);
  });
}

// Replace with your serialized transaction
//const serializedTx = "010005075c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845fd8df0dbec03bfdc783d6ae9a1e6e875324b420753139752d1cc385f9e4bce782ddf42a04800a54de2e583f94f17b089725b772d1333526271241532776d2ffc606a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc00000000006a1d817a502050b680791e6ce6db88e1e5b7150f61fc6790a4eb4d10000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b210000000006a7d517193584d0feed9bb3431d13206be544281b57b8566cc5375ff400000052cfe49b33d522b61732c0ec47e1739fe8981c419f43a7f965a88d4c0c1afb190103060102050604000402000000";
const serializedTx = "0200080a5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f45c2483815bdb0bf87ab6178467767e877706874276b3e14b6cf5691b5ef934a00000000000000000000000000000000000000000000000000000000000000000306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a40000000ea1a2a344a8f706360bf067dc7465fe5db8354dd88c12c94956caad628cfddef06a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc00000000006a1d817a502050b680791e6ce6db88e1e5b7150f61fc6790a4eb4d10000000006a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b210000000006a7d517192c5c51218cc94c3d4af17f58daee089ba1fd44e3dbd98a0000000006a7d517193584d0feed9bb3431d13206be544281b57b8566cc5375ff400000034fa466f94933ce478072ac62167f4d73a36718be83dd44549fe08c4f0edf0660402020001340000000000e1f50500000000c80000000000000006a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc0000000000502010874000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f5c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f000000000000000000000000000000005c60cfc872c5dd1ae6ab0e194b94e5b7662bcb95e0071ba538bf32e29b8b845f03000903204e00000000000005060104070906000402000000";
deserializeTransactionData(serializedTx);
