// Imported FIRST by deploy-preprod.ts, and the order matters.
//
// @effectstream/midnight-contracts resolves midnightNetworkConfig into a const
// at module-evaluation time. ESM hoists imports, so anything set in the body of
// the deploy script lands too late and the SDK has already decided it is on the
// local "undeployed" network with the genesis wallet. That failure is quiet: it
// deploys successfully, to the wrong chain, with the wrong wallet.
//
// So every environment variable the SDK reads is set here, in a module that is
// evaluated before the SDK is imported.

import { Buffer } from "node:buffer";
import { pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const readLocalEnv = (key: string): string | undefined => {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", "../../.env.local", "/app/.env.local"]) {
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

const targetNetwork = process.env.MIDNIGHT_NETWORK_ID ?? "preprod";
const isLocal = targetNetwork === "undeployed";

// The local chain funds a genesis wallet, so a mnemonic is only needed for a
// real network.
const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic && !isLocal) {
  console.error("No MIDNIGHT_WALLET_MNEMONIC. Put it in .env.local (gitignored).");
  process.exit(1);
}

// BIP39 seed derivation, which is all the SDK's own mnemonicToSeed does:
// PBKDF2-HMAC-SHA512 over the NFKD mnemonic, salt "mnemonic", 2048 rounds,
// 64 bytes out. Using the 32-byte entropy instead derives a different wallet
// and reports nothing, so this is worth being exact about.
const words = (mnemonic ?? "").trim().split(/\s+/).join(" ").normalize("NFKD");
if (!isLocal) {
  const wordCount = words.split(" ").length;
  if (wordCount !== 12 && wordCount !== 24) {
    console.error(`expected a 12 or 24 word mnemonic, got ${wordCount}`);
    process.exit(1);
  }
  const seed = pbkdf2Sync(words, "mnemonic".normalize("NFKD"), 2048, 64, "sha512");
  process.env.MIDNIGHT_WALLET_SEED = seed.toString("hex");
}

process.env.MIDNIGHT_NETWORK_ID = targetNetwork;
const net = targetNetwork;

if (!isLocal) {
  process.env.MIDNIGHT_NODE_HTTP ??= `https://rpc.${net}.midnight.network`;
  process.env.MIDNIGHT_INDEXER_HTTP ??= `https://indexer.${net}.midnight.network/api/v4/graphql`;
  process.env.MIDNIGHT_INDEXER_WS ??= `wss://indexer.${net}.midnight.network/api/v4/graphql/ws`;
}
// proving stays local
process.env.MIDNIGHT_PROOF_SERVER_URL ??= "http://127.0.0.1:6300";
// 16+ chars, three of four character classes
process.env.MIDNIGHT_STORAGE_PASSWORD ??= "DarkMarketSeal1!";
// preprod's first sync is a full-chain scan and the dust stream is the long pole
process.env.MIDNIGHT_WALLET_SYNC_TIMEOUT_MS ??= String(3 * 60 * 60 * 1000);

const expected = isLocal ? undefined : readLocalEnv("MIDNIGHT_WALLET_ADDRESS");
console.log("network:", net);
console.log("node:   ", process.env.MIDNIGHT_NODE_HTTP);
console.log("indexer:", process.env.MIDNIGHT_INDEXER_HTTP);
console.log("proof:  ", process.env.MIDNIGHT_PROOF_SERVER_URL);
if (expected) console.log("expecting wallet:", expected.slice(0, 20) + "...");
