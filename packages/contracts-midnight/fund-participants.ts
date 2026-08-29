// Send NIGHT from participant 0 to participants 1..4.
//
// Participant 0 is the wallet that was funded from the faucet. Everyone else
// starts empty, and a wallet with no NIGHT cannot register for dust, and a
// wallet with no dust cannot pay for a transaction. So this runs first, once,
// and the rest of the demo depends on it having worked.

import "./midnight-target.ts";
import "@midnight-ntwrk/onchain-runtime-v3";

import {
  buildWalletAndWaitForFunds,
  buildWalletFacade,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { UnshieldedAddress } from "@midnightntwrk/wallet-sdk-address-format";
import { allSeeds, readLocalEnv, PARTICIPANTS } from "./participants.ts";

// Enough to register for dust and pay for a handful of transactions.
const PER_PARTICIPANT = BigInt(process.env.DARKMARKET_FUND_EACH ?? "150000000");

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic) {
  console.error("no MIDNIGHT_WALLET_MNEMONIC");
  process.exit(1);
}

const networkId = (process.env.MIDNIGHT_NETWORK_ID ?? "preprod") as never;
const net = midnightNetworkConfig;
const urls = {
  id: net.id,
  indexer: net.indexer,
  indexerWS: net.indexerWS,
  node: net.node,
  proofServer: net.proofServer,
};
const seeds = allSeeds(mnemonic);

// Recipient addresses first, cheaply, without waiting for anyone to sync.
const recipients: string[] = [];
for (let i = 1; i < PARTICIPANTS; i++) {
  const w = await buildWalletFacade(urls as never, seeds[i], networkId);
  recipients.push(w.unshieldedAddress);
  console.log(`participant ${i}: ${w.unshieldedAddress}`);
  try {
    await (w.wallet as { close?: () => Promise<void> }).close?.();
  } catch {}
}

console.log("");
console.log("building participant 0 and waiting for its funds...");
const payer = await buildWalletAndWaitForFunds(urls as never, seeds[0], networkId);
console.log("participant 0 ready");

const token = unshieldedToken();
const outputs = recipients.map((addr) => ({
  type: token.tag ?? token,
  receiverAddress: UnshieldedAddress.codec.decode(addr),
  amount: PER_PARTICIPANT,
}));

console.log("");
console.log(`sending ${PER_PARTICIPANT} NIGHT to each of ${outputs.length}`);

const recipe = await payer.wallet.transferTransaction(
  [{ type: "unshielded", outputs } as never],
  {
    shieldedSecretKeys: payer.walletZswapSecretKeys,
    dustSecretKey: payer.walletDustSecretKey,
  },
  { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: true },
);

const signed = await payer.wallet.signRecipe(recipe, (payload: unknown) =>
  (payer.unshieldedKeystore as { signDataAsync: (p: unknown) => Promise<unknown> })
    .signDataAsync(payload),
);
const finalized = await payer.wallet.finalizeRecipe(signed as never);
const txId = await payer.wallet.submitTransaction(finalized as never);

console.log(`submitted: ${txId}`);
console.log("");
console.log("each participant now needs to register its NIGHT for dust before");
console.log("it can pay for anything. that happens on their first sync.");
process.exit(0);
