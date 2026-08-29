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
const MARKET = process.env.DARKMARKET_MARKET ??
  "will-there-be-no-change-in-fed-interest-rates-after-the-september-2026";

// Five intents. 800 of YES across three, 300 of NO across two, so the epoch
// crosses 300 internally and only 500 YES should ever reach Polymarket.
const INTENTS = [
  { side: true, size: 500n },
  { side: true, size: 200n },
  { side: false, size: 100n },
  { side: true, size: 100n },
  { side: false, size: 200n },
];

const fixed = (s: string, len: number): Uint8Array => {
  const b = Buffer.alloc(len);
  Buffer.from(s, "utf8").copy(b, 0, 0, Math.min(len, Buffer.byteLength(s)));
  return new Uint8Array(b);
};

const contractData = readMidnightContract("contract-round-value", { networkId: NETWORK });
if (!contractData.contractAddress) {
  console.error(`no deployed contract recorded for ${NETWORK}. deploy first.`);
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
console.log(`contract: ${contractData.contractAddress}`);
console.log(`market:   ${MARKET}`);
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
  contractAddress: contractData.contractAddress,
  compiledContract: compiled as never,
  privateStateId: "darkmarketPrivateState",
  initialPrivateState: {},
});
console.log(`joined ${dm.deployTxData.public.contractAddress}`);
console.log("");

// --- sealed phase -----------------------------------------------------------
const marketBytes = fixed(MARKET, 64);
const blinds = INTENTS.map(() => new Uint8Array(randomBytes(32)));

console.log("sealing intents (side and size stay local):");
for (let i = 0; i < INTENTS.length; i++) {
  const c = Contract.pureCircuits.intent_commitment(INTENTS[i].side, INTENTS[i].size, blinds[i]);
  const tx = await dm.callTx.commit_intent(marketBytes, c);
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

const state = await providers.publicDataProvider.queryContractState(contractData.contractAddress);
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
