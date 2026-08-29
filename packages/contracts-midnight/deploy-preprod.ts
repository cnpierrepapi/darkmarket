// Deploy the DARKMARKET circuit to Midnight preprod.
//
// The wallet arrives as a 24-word mnemonic. The SDK wants a hex seed, and the
// conversion is BIP39 PBKDF2 (64 bytes), NOT the 32-byte entropy. Getting that
// wrong derives a different wallet and reports no error at all: the deploy just
// sits there waiting for funds that are sitting in an address you never checked.
//
// The mnemonic is read from the environment or from .env.local, both of which
// stay out of git. Nothing secret belongs in this file.

import "@midnightntwrk/onchain-runtime-v4";

import { existsSync, readFileSync } from "node:fs";
import { mnemonicToSeed } from "@effectstream/midnight-contracts/mnemonicToSeed";
import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import type { DeployConfig } from "@effectstream/midnight-contracts/types";
import { Counter, witnesses } from "./contract-round-value/src/index.original.ts";

const readLocalEnv = (key: string): string | undefined => {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", "../../.env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const at = line.indexOf("=");
      if (at < 0) continue;
      if (line.slice(0, at).trim() === key) {
        return line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
};

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic) {
  console.error(
    "No MIDNIGHT_WALLET_MNEMONIC. Put it in .env.local (gitignored) or export it.",
  );
  process.exit(1);
}

const seed = await mnemonicToSeed(mnemonic);
process.env.MIDNIGHT_WALLET_SEED = seed.toString("hex");

// preprod, with proving done by the local proof server
process.env.MIDNIGHT_NETWORK_ID ??= "preprod";
process.env.MIDNIGHT_PROOF_SERVER_URL ??= "http://127.0.0.1:6300";
// needs 16+ chars across three of four character classes
process.env.MIDNIGHT_STORAGE_PASSWORD ??= "DarkMarketSeal1!";
// preprod's first sync is a full-chain scan, and the dust stream is the long
// pole. Give it room rather than letting a default timeout kill an hour of work.
process.env.MIDNIGHT_WALLET_SYNC_TIMEOUT_MS ??= String(3 * 60 * 60 * 1000);

const network = midnightNetworkConfig;
console.log("network:", network.networkId);
console.log("node:   ", network.node);
console.log("indexer:", network.indexer);
console.log("proof:  ", network.proofServer);

const config: DeployConfig = {
  contractName: "contract-round-value",
  contractFileName: "darkmarket.json",
  contractClass: Counter.Contract,
  witnesses,
  privateStateId: "darkmarketPrivateState",
  initialPrivateState: {},
  privateStateStoreName: "darkmarket-private-state",
};

deployMidnightContract(config, network)
  .then(() => {
    console.log("deployed");
    process.exit(0);
  })
  .catch((e: unknown) => {
    console.error("deploy failed:", e);
    process.exit(1);
  });
