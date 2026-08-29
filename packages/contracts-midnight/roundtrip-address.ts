// Is the shielded address I generated actually well formed?
// Encode it, parse it back, and see whether the SDK agrees with itself.
// If it round-trips, the address is fine and the faucet wants something else.

import "./midnight-target.ts";
import "@midnight-ntwrk/onchain-runtime-v3";

import {
  buildWalletFacade,
  getInitialShieldedState,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import {
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
} from "@midnightntwrk/wallet-sdk-address-format";
import { allSeeds, readLocalEnv } from "./participants.ts";

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC")!;
const networkId = (process.env.MIDNIGHT_NETWORK_ID ?? "preprod") as never;
const net = midnightNetworkConfig;
const urls = { id: net.id, indexer: net.indexer, indexerWS: net.indexerWS, node: net.node, proofServer: net.proofServer };

const w = await buildWalletFacade(urls as never, allSeeds(mnemonic)[0], networkId, "dust-only");
const st: Record<string, unknown> = await getInitialShieldedState(
  (w.wallet as unknown as { shielded: unknown }).shielded as never,
);
const addr = st.address as never;

const bech = MidnightBech32m.encode(networkId, addr).asString();
console.log("encoded  :", bech);

const parsed = MidnightBech32m.parse(bech);
console.log("parsed   : type =", parsed.type, "| network =", parsed.network);

try {
  const back = parsed.decode(ShieldedAddress as never, networkId);
  console.log("decoded  : ok,", (back as { coinPublicKeyString: () => string }).coinPublicKeyString().slice(0, 20) + "...");
  console.log("ROUND TRIP OK - the address is well formed");
} catch (e: unknown) {
  console.log("decode failed:", String((e as Error)?.message ?? e).slice(0, 160));
}

// And what the unshielded one parses as, for comparison
const u = MidnightBech32m.parse(w.unshieldedAddress);
console.log("");
console.log("unshielded:", w.unshieldedAddress.slice(0, 34) + "...");
console.log("  type =", u.type, "| network =", u.network);
void UnshieldedAddress;

process.exit(0);
