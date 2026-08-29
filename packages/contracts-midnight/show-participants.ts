// Print the five participants' addresses. No transactions, just derivation,
// so this is safe to run any time and is how you find out where to send funds.

import "./midnight-target.ts";

import { buildWalletFacade, midnightNetworkConfig } from "@effectstream/midnight-contracts";
import { allSeeds, readLocalEnv, PARTICIPANTS } from "./participants.ts";

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic) {
  console.error("no MIDNIGHT_WALLET_MNEMONIC");
  process.exit(1);
}

const net = midnightNetworkConfig;
const urls = {
  id: net.id,
  indexer: net.indexer,
  indexerWS: net.indexerWS,
  node: net.node,
  proofServer: net.proofServer,
};
const networkId = (process.env.MIDNIGHT_NETWORK_ID ?? "preprod") as never;
const seeds = allSeeds(mnemonic);

console.log(`network: ${networkId}`);
console.log("");

for (let i = 0; i < PARTICIPANTS; i++) {
  const w = await buildWalletFacade(urls as never, seeds[i], networkId);
  console.log(`participant ${i}${i === 0 ? "  (the funded one)" : ""}`);
  console.log(`  night: ${w.unshieldedAddress}`);
  console.log(`  dust:  ${w.dustAddress}`);
  console.log("");
  try {
    await (w.wallet as { close?: () => Promise<void> }).close?.();
  } catch {
    // closing is best effort; we only wanted the addresses
  }
}

process.exit(0);
