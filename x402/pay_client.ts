/**
 * Paying client for GET /data on merchant_server.ts.
 * wrapFetchWithPayment handles the 402 → sign → retry loop.
 *
 * Docs: https://docs.figment.io/recipes/test-x402-api-on-solana-devnet
 */
import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), ".env") });

import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

const svmPrivateKey = process.env.SVM_PRIVATE_KEY;
const baseUrl = process.env.MERCHANT_API_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/data";
const network =
  process.env.SVM_NETWORK || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

if (!svmPrivateKey) {
  console.error(
    "Set SVM_PRIVATE_KEY to a base58 Solana secret key funded with USDC."
  );
  process.exit(1);
}

async function main() {
  const svmSigner = await createKeyPairSignerFromBytes(
    base58.decode(svmPrivateKey)
  );

  const client = new x402Client();
  client.register(network, new ExactSvmScheme(svmSigner));

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const url = `${baseUrl}${endpointPath}`;

  console.log(`requesting ${url}`);
  console.log(`payer:     ${svmSigner.address}`);

  const response = await fetchWithPayment(url, { method: "GET" });
  const body = (response.headers.get("content-type") ?? "").includes(
    "application/json"
  )
    ? await response.json()
    : await response.text();

  console.log("\nresponse body:", body);

  const settleResponse = new x402HTTPClient(client).getPaymentSettleResponse(
    (name) => response.headers.get(name)
  );
  if (settleResponse) {
    console.log("\nsettle response:", settleResponse);
    if (settleResponse.transaction) {
      const cluster = network.includes("EtWTRABZaYq6iMfeYKouRu166VU2xqa1")
        ? "?cluster=devnet"
        : "";
      console.log(
        `solscan:  https://solscan.io/tx/${settleResponse.transaction}${cluster}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
