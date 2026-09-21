/**
 * Sample merchant (resource server) that gates GET /data behind x402.
 * Registers the Solana exact scheme with Figment's facilitator.
 *
 * Docs: https://docs.figment.io/recipes/recipe-title
 *       https://docs.figment.io/reference/x402
 */
import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), ".env") });

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const svmAddress = process.env.SVM_ADDRESS;
const facilitatorUrl =
  process.env.FACILITATOR_URL || "https://api.figment.io/x402";
const facilitatorApiKey = process.env.API_KEY;
// Must match a kind from GET /x402/supported (CAIP-2). Devnet default:
const network =
  process.env.SVM_NETWORK || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const port = Number(process.env.PORT || 4021);

if (!svmAddress) {
  console.error(
    "Set SVM_ADDRESS to the Solana wallet that should receive USDC payments."
  );
  process.exit(1);
}

if (!facilitatorApiKey) {
  console.error("Set API_KEY (Figment x-api-key).");
  process.exit(1);
}

const authHeaders = { "x-api-key": facilitatorApiKey };

const facilitatorClient = new HTTPFacilitatorClient({
  url: facilitatorUrl,
  createAuthHeaders: async () => ({
    verify: authHeaders,
    settle: authHeaders,
    supported: authHeaders,
  }),
});

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /data": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network,
            payTo: svmAddress,
          },
        ],
        description: "Sample paid data endpoint",
        mimeType: "application/json",
      },
    },
    // Register the SVM exact scheme so the middleware can verify/settle via Figment.
    new x402ResourceServer(facilitatorClient).register(
      network,
      new ExactSvmScheme()
    )
  )
);

app.get("/data", (_req, res) => {
  res.json({
    secret: "gm — you paid 0.001 USDC for this",
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`merchant on http://localhost:${port}`);
  console.log(`  facilitator: ${facilitatorUrl}`);
  console.log(`  payTo:       ${svmAddress}`);
  console.log(`  network:     ${network}`);
});
