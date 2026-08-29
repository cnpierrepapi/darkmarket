// The faucet drips to a shielded address, not the unshielded NIGHT address.
// This prints every address form each participant has, so we can see which one
// the faucet will accept.

import "./midnight-target.ts";
import "@midnight-ntwrk/onchain-runtime-v3";

import {
  buildWalletFacade,
  getInitialShieldedState,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { MidnightBech32m } from "@midnightntwrk/wallet-sdk-address-format";
import { allSeeds, readLocalEnv, PARTICIPANTS } from "./participants.ts";

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic) { console.error("no mnemonic"); process.exit(1); }

const networkId = (process.env.MIDNIGHT_NETWORK_ID ?? "preprod") as never;
const net = midnightNetworkConfig;
const urls = { id: net.id, indexer: net.indexer, indexerWS: net.indexerWS, node: net.node, proofServer: net.proofServer };
const seeds = allSeeds(mnemonic);
const only = process.argv[2] ? [Number(process.argv[2])] : [...Array(PARTICIPANTS).keys()];

for (const i of only) {
  const w = await buildWalletFacade(urls as never, seeds[i], networkId, "dust-only");
  console.log(`participant ${i}`);
  console.log(`  night:    ${w.unshieldedAddress}`);
  console.log(`  dust:     ${w.dustAddress}`);
  try {
    const st: Record<string, unknown> = await getInitialShieldedState(
      (w.wallet as unknown as { shielded: unknown }).shielded as never,
    );
    const addr = st.address as Record<string, unknown> | undefined;
    if (addr) {
      for (const m of ["toString", "asString", "coinPublicKeyString", "bech32", "encode"]) {
        const fn = addr[m];
        if (typeof fn === "function") {
          try {
            const v = String((fn as () => unknown).call(addr));
            if (v && v !== "[object Object]") console.log(`  shielded(${m}): ${v}`);
          } catch { /* some accessors need args */ }
        }
      }
      // The shielded address the faucet wants is the bech32 encoding of the
      // whole ShieldedAddress, not either key on its own.
      try {
        const bech = MidnightBech32m.encode(networkId as never, addr as never).asString();
        console.log(`  SHIELDED: ${bech}`);
      } catch (e: unknown) {
        console.log(`  bech32 encode failed: ${String((e as Error)?.message ?? e).slice(0, 110)}`);
      }
    }
  } catch (e: unknown) {
    console.log(`  shielded read failed: ${String((e as Error)?.message ?? e).slice(0, 110)}`);
  }
  console.log("");
}
process.exit(0);
