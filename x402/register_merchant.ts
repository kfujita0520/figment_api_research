/**
 * Merchant bootstrap against the Figment x402 facilitator.
 * There is no dedicated merchant-registration API; call GET /x402/supported at startup
 * to learn which (scheme, network) pairs you can charge on and the fee-payer address.
 *
 * Docs: https://docs.figment.io/reference/x402
 *       https://docs.figment.io/reference/get_x402-supported
 */
import axios from "axios";
import { randomUUID } from "crypto";
import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), ".env") });

const FIGMENT_API_KEY = process.env.API_KEY;
const FACILITATOR_BASE =
  process.env.FACILITATOR_URL || "https://api.figment.io/x402";

// Solana Devnet CAIP-2 identifier. Switch to mainnet:
//   solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
const TARGET_NETWORK =
  process.env.SVM_NETWORK_CAIP2 || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const TARGET_SCHEME = process.env.X402_SCHEME || "exact";

if (!FIGMENT_API_KEY) {
  throw new Error("Set API_KEY in .env (Figment x-api-key)");
}

type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { feePayer?: string; [k: string]: unknown };
};

type SupportedResponse = {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
};

const headers = {
  accept: "application/json",
  "x-api-key": FIGMENT_API_KEY,
};

async function fetchSupported(): Promise<SupportedResponse> {
  const requestId = randomUUID();
  const { data } = await axios.get<SupportedResponse>(
    `${FACILITATOR_BASE}/supported`,
    {
      headers: {
        ...headers,
        "x-request-id": requestId,
      },
    }
  );

  console.log("x-request-id:", requestId);
  return data;
}

function pickKind(
  supported: SupportedResponse,
  network: string,
  scheme: string
): SupportedKind {
  const kind = supported.kinds.find(
    (k) => k.network === network && k.scheme === scheme
  );
  if (!kind?.extra?.feePayer) {
    throw new Error(
      `No kind for scheme=${scheme} network=${network} (or missing extra.feePayer)`
    );
  }
  return kind;
}

async function main() {
  console.log("=== Figment x402 merchant bootstrap (GET /supported) ===");
  console.log("facilitator:", FACILITATOR_BASE);

  const supported = await fetchSupported();

  if (!supported.kinds?.length) {
    throw new Error("Facilitator returned no supported kinds");
  }

  console.log("extensions:", supported.extensions);
  console.log("signers:", supported.signers);
  console.log("kinds:");
  for (const kind of supported.kinds) {
    console.log({
      x402Version: kind.x402Version,
      scheme: kind.scheme,
      network: kind.network,
      feePayer: kind.extra?.feePayer,
    });
  }

  const kind = pickKind(supported, TARGET_NETWORK, TARGET_SCHEME);
  console.log("\nEmbed this feePayer in every paymentRequirements.extra:");
  console.log(kind.extra!.feePayer);
  console.log("Echo this x402Version on payloads:", kind.x402Version);
}

main().catch((err) => {
  console.error(err.response?.data ?? err.message);
  process.exit(1);
});
