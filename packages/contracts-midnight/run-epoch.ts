// Drive one DARKMARKET epoch against a real chain.
//
// Seals five intents, closes the epoch, then reads back what the chain can see.
// Every call here is a real transaction with a real proof.
//
// The sealing side is the interesting part: the commitment is computed locally
// with the pure `intent_commitment` circuit, so side and size never leave this
// process. What goes on chain during the sealed phase is 32 bytes of noise.

import "./midnight-target.ts";
import "@midnightntwrk/onchain-runtime-v4";

import { randomBytes } from "node:crypto";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
  readMidnightContract,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as Contract from "@evm-midnight/midnight-contract/contract";

const NETWORK = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
// Polymarket's conditionId for the market this epoch trades. 32 bytes, and the
// same value Polymarket's own contract uses on Polygon, so both chains key on
// one identifier. Default is the Fed September 2026 rates market.
const CONDITION_ID = process.env.DARKMARKET_CONDITION_ID ??
  "0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a";

// Five intents. 800 of YES across three, 300 of NO across two, so the epoch
// crosses 300 internally and only 500 YES should ever reach Polymarket.
const INTENTS = [
  { side: true, size: 500n },
  { side: true, size: 200n },
  { side: false, size: 100n },
  { side: true, size: 100n },
  { side: false, size: 200n },
];

const hex32 = (h: string): Uint8Array => {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  if (clean.length !== 64) {
    throw new Error(`conditionId must be 32 bytes of hex, got ${clean.length / 2} bytes`);
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
};

// An explicit address wins. The container's orchestrator also deploys on
// startup and records its own, so guessing from disk picks the wrong contract
// about half the time.
const explicit = process.argv[2];
const contractData = readMidnightContract("contract-round-value", { networkId: NETWORK });
const contractAddress = explicit ?? contractData.contractAddress;
if (!contractAddress) {
  console.error(`no contract address. pass one, or deploy first.`);
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

console.log(`network:  ${NETWORK}`);
console.log(`contract: ${contractAddress}`);
console.log(`condition: ${CONDITION_ID}`);
console.log("");

const w = await buildWalletAndWaitForFunds(urls as never, net.walletSeed!, NETWORK as never);
const providers = await configureMidnightNodeProviders(
  w.wallet,
  w.zswapSecretKeys,
  w.walletZswapSecretKeys,
  w.dustSecretKey,
  w.walletDustSecretKey,
  urls as never,
  "darkmarket-private-state",
  contractData.zkConfigPath,
  w.unshieldedKeystore,
);

const compiled = CompiledContract.make("contract-round-value", Contract.Contract).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets("./"),
);
const dm = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: compiled as never,
  privateStateId: "darkmarketPrivateState",
  initialPrivateState: {},
});
console.log(`joined ${dm.deployTxData.public.contractAddress}`);
console.log("");

// --- sealed phase -----------------------------------------------------------
const conditionBytes = hex32(CONDITION_ID);
const blinds = INTENTS.map(() => new Uint8Array(randomBytes(32)));

console.log("sealing intents (side and size stay local):");
for (let i = 0; i < INTENTS.length; i++) {
  const c = Contract.pureCircuits.intent_commitment(INTENTS[i].side, INTENTS[i].size, blinds[i]);
  const tx = await dm.callTx.commit_intent(conditionBytes, c);
  console.log(
    `  ${i + 1}/5 sealed  commitment=${Buffer.from(c).toString("hex").slice(0, 16)}...  block ${tx.public.blockHeight}`,
  );
}
console.log("");

// --- open phase -------------------------------------------------------------
console.log("closing the epoch (all five opened in one call)...");
const closeTx = await dm.callTx.close_epoch(
  INTENTS.map((i) => i.side),
  INTENTS.map((i) => i.size),
  blinds,
);
console.log(`closed in block ${closeTx.public.blockHeight}`);
console.log("");

const state = await providers.publicDataProvider.queryContractState(contractAddress);
const l = Contract.ledger(state!.data);
console.log("--- what the chain now shows ---");
console.log(`YES total:    ${l.yes_notional}`);
console.log(`NO total:     ${l.no_notional}`);
console.log(`participants: ${l.participants}`);
console.log(`epoch:        ${l.epoch}`);
console.log("");
console.log("the five individual sizes are not recoverable from that state.");

await w.wallet.close?.();
process.exit(0);
