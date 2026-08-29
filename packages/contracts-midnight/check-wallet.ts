// Does the mnemonic we hold actually derive the address we were given?
// If not, every funding question is chasing the wrong wallet.
import "./midnight-target.ts";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { buildWalletFacade, midnightNetworkConfig } from "@effectstream/midnight-contracts";

const readEnv = (key: string): string | undefined => {
  for (const f of [".env.local", "/app/.env.local", "../../.env.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0 && line.slice(0, at).trim() === key) {
        return line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
};

const expected = readEnv("MIDNIGHT_WALLET_ADDRESS") ?? "";
const net = midnightNetworkConfig;
const urls = { id: net.id, indexer: net.indexer, indexerWS: net.indexerWS, node: net.node, proofServer: net.proofServer };

const r = await buildWalletFacade(urls as never, net.walletSeed!, (process.env.MIDNIGHT_NETWORK_ID ?? "preprod") as never);

console.log("");
console.log("expected (from env.txt):", expected);
console.log("derived unshielded:     ", r.unshieldedAddress);
console.log("derived dust:           ", r.dustAddress);
console.log("");
console.log(expected && r.unshieldedAddress === expected
  ? "MATCH. the mnemonic controls that address."
  : "MISMATCH. the mnemonic does not derive the address we were given.");
process.exit(0);
