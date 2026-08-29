// Read a DARKMARKET epoch straight off the Midnight ledger.
//
// No wallet, no funds, no signing, no proof server. The public ledger is
// public, so anyone can run this, which is the point: it is exactly what an
// observer of the chain can learn about an epoch. Everything it prints is
// everything that leaked.

// ledger-v9 pulls in the single WASM instance; onchain-runtime-v4 is not
// resolvable from every workspace package and is not needed for a pure read.
import "@midnightntwrk/ledger-v9";

import { readFileSync } from "node:fs";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import * as Contract from "@evm-midnight/midnight-contract/contract";
import { netOff, shieldedFraction, type Aggregate } from "./netting.ts";

const NETWORK = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
const INDEXER = process.env.MIDNIGHT_INDEXER_HTTP ??
  (NETWORK === "undeployed"
    ? "http://127.0.0.1:8088/api/v4/graphql"
    : `https://indexer.${NETWORK}.midnight.network/api/v4/graphql`);
const INDEXER_WS = process.env.MIDNIGHT_INDEXER_WS ??
  (NETWORK === "undeployed"
    ? "ws://127.0.0.1:8088/api/v4/graphql/ws"
    : `wss://indexer.${NETWORK}.midnight.network/api/v4/graphql/ws`);

// conditionId comes back as raw bytes; render it the way Polymarket writes it.
const toHex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);

const contractAddress = process.argv[2] ?? (() => {
  const file = `./darkmarket.${NETWORK}.json`;
  try {
    return JSON.parse(readFileSync(file, "utf8")).contractAddress as string;
  } catch {
    return undefined;
  }
})();

if (!contractAddress) {
  console.error("usage: bun run ledger-read.ts <contractAddress>");
  process.exit(1);
}

setNetworkId(NETWORK as never);
const provider = indexerPublicDataProvider(INDEXER, INDEXER_WS);
const state = await provider.queryContractState(contractAddress);
if (!state) {
  console.error(`no contract state at ${contractAddress} on ${NETWORK}`);
  process.exit(1);
}

const l = Contract.ledger(state.data);

const agg: Aggregate = {
  conditionId: isZero(l.condition_id) ? "" : toHex(l.condition_id),
  yesNotional: l.yes_notional,
  noNotional: l.no_notional,
  participants: Number(l.participants),
  epoch: Number(l.epoch),
};

console.log(`network:  ${NETWORK}`);
console.log(`contract: ${contractAddress}`);
console.log("");
console.log("--- everything the chain reveals ---");
console.log(`condition id:  ${agg.conditionId || "(unset)"}`);
console.log(`epoch:         ${agg.epoch}`);
console.log(`sealed so far: ${l.pending}`);
console.log(`participants:  ${agg.participants}`);
console.log(`YES total:     ${agg.yesNotional}`);
console.log(`NO total:      ${agg.noNotional}`);
console.log(`calls:         ${l.round}`);
console.log("");
console.log("--- what the pool does with it ---");
const residual = netOff(agg);
if (residual.kind === "crossed") {
  console.log(`fully crossed at ${residual.crossed}. nothing reaches Polymarket.`);
} else {
  console.log(`crossed internally: ${residual.crossed}`);
  console.log(`sent to Polymarket: ${residual.size} ${residual.side}`);
}
console.log(`kept private:       ${shieldedFraction(agg)}% of submitted notional`);
console.log("");
console.log("individual intents are not in this output because they are not on the chain.");
