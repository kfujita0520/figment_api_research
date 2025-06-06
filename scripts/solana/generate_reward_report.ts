import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from "dotenv";
import { start } from 'repl';
config();


const rewardsReportPath = path.join(__dirname, '../reports/rewards-summary.html');
const API_URL = 'https://api.figment.io/solana/rewards';
const startDate = '2025-01-01';
const endDate = '2025-01-31';
const system_accounts = [
  "DkBfzRBRVWcUay43VVVA3bj7xGMiynbJhCry2f2mKjCr"
];

async function main(){

  let rewardsData: any = await fetchRewards(startDate, endDate, system_accounts);

  // Initialize a summary object
  const summary = {};

  // Process each reward entry
  rewardsData.data.forEach(entry => {
    const { stake_account, rewards } = entry;

    // Initialize the summary for the system account if it doesn't exist
    if (!summary[stake_account]) {
      summary[stake_account] = {
        protocol: 0,
        mev: 0,
      };
    }

    // Sum up the rewards for the system account
    rewards.forEach(reward => {
      if (reward.type === 'protocol') {
        summary[stake_account].protocol += reward.numeric / Math.pow(10, reward.exp);
      } else if (reward.type === 'mev') {
        summary[stake_account].mev += reward.numeric / Math.pow(10, reward.exp);
      }
    });
  });

  // Calculate total rewards
  let totalProtocolRewards = 0;
  let totalMevRewards = 0;

  Object.keys(summary).forEach(account => {
    totalProtocolRewards += summary[account].protocol;
    totalMevRewards += summary[account].mev;
  });

  // Print the summary
  console.log('Reward Summary:');
  console.log(`Total Rewards: ${(totalProtocolRewards + totalMevRewards).toFixed(9)} SOL`);
  console.log(`  Total Protocol Rewards: ${totalProtocolRewards.toFixed(9)} SOL`);
  console.log(`  Total MEV Rewards: ${totalMevRewards.toFixed(9)} SOL`)
  console.log('Breakdown by stake account:');
  Object.keys(summary).forEach(account => {
    console.log(`Stake Account: ${account}`);
    console.log(`  Protocol Rewards: ${summary[account].protocol.toFixed(9)} SOL`);
    console.log(`  MEV Rewards: ${summary[account].mev.toFixed(9)} SOL`);
  });

  // Generate and save HTML report
  const htmlContent = generateHTML(summary, totalProtocolRewards, totalMevRewards, startDate, endDate);
  fs.mkdirSync(path.dirname(rewardsReportPath), { recursive: true });
  fs.writeFileSync(rewardsReportPath, htmlContent);
  console.log(`HTML report generated at: ${rewardsReportPath}`);
}


async function fetchRewards(start: string, end: string, systemAccounts: string[]) { 
  // Define request body parameters
  const requestBody = {
      start: "2025-02-01", // Replace with actual start date (YYYY-MM-DD) or epoch timestamp
      end: "2025-02-20",   // Replace with actual end date (YYYY-MM-DD) or epoch timestamp
      system_accounts: [
          "DkBfzRBRVWcUay43VVVA3bj7xGMiynbJhCry2f2mKjCr"
      ] // Replace with actual Solana system account addresses
  };

  try {
      const response = await axios.post(API_URL, requestBody, {
          headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': process.env.API_KEY
          }
      });

      console.log('Response:', response.data);
      return response.data;
  } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);
  }
};

function generateHTML(summary: any, totalProtocolRewards: number, totalMevRewards: number, startDate: string, endDate: string) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Solana Rewards Summary</title>
         <style>
            body {
                font-family: Arial, sans-serif;
                margin: 40px;
                background-color: #f5f5f5;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background-color: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            .summary-box {
                background-color: #f8f9fa;
                border-radius: 5px;
                padding: 20px;
                margin-bottom: 20px;
            }
            .breakdown {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .account-card {
                background-color: white;
                border: 1px solid #dee2e6;
                border-radius: 5px;
                padding: 15px;
            }
            .account-address {
                background-color: #f8f9fa;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                word-break: break-all;
                margin-bottom: 10px;
                border: 1px solid #dee2e6;
            }
            .protocol {
                color: #2ecc71;
                margin: 5px 0;
            }
            .mev {
                color: #e74c3c;
                margin: 5px 0;
            }
            .total {
                font-size: 24px;
                color: #2c3e50;
                margin-bottom: 10px;
            }
            .date-range {
                color: #666;
                font-size: 16px;
                margin-bottom: 20px;
                text-align: center;
            }
        </style>
      </head>
      <body>
          <div class="container">
              <h1>Solana Rewards Summary</h1>
              <div class="date-range">
                  From ${startDate} to ${endDate}
              </div>
              <div class="summary-box">
                  <div class="total">
                      Total Rewards: ${(totalProtocolRewards + totalMevRewards).toFixed(9)} SOL
                  </div>
                  <div class="protocol">
                      Protocol Rewards: ${totalProtocolRewards.toFixed(9)} SOL
                  </div>
                  <div class="mev">
                      MEV Rewards: ${totalMevRewards.toFixed(9)} SOL
                  </div>
              </div>
  
              <h2>Breakdown by Stake Account</h2>
              <div class="breakdown">
                  ${Object.entries(summary)
                    .map(([account, rewards]: [string, any]) => `
                      <div class="account-card">
                          <h4>${account}</h4>
                          <div class="protocol">
                              Protocol: ${rewards.protocol.toFixed(9)} SOL
                          </div>
                          <div class="mev">
                              MEV: ${rewards.mev.toFixed(9)} SOL
                          </div>
                      </div>
                    `)
                    .join('')}
              </div>
          </div>
      </body>
      </html>
    `;
  };
  

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
.then(() => process.exit(0))
.catch((error) => {
    console.error(error);
    process.exit(1);
});