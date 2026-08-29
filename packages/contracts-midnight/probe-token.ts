import { unshieldedToken, rawTokenType } from "@midnight-ntwrk/ledger-v8";
import { UnshieldedAddress } from "@midnightntwrk/wallet-sdk-address-format";

const t: any = unshieldedToken();
console.log("unshieldedToken() type:", typeof t, t?.constructor?.name);
console.log("  keys:", Object.keys(t ?? {}));
console.log("  value:", String(t).slice(0, 120));
for (const k of ["tag", "raw", "type"]) {
  try { console.log(`  .${k}:`, String(t?.[k]).slice(0, 90)); } catch {}
}
const a: any = UnshieldedAddress.codec.decode("mn_addr_preprod1zarhlar8qrmjmhnfnk64pemhy4xyzdwfzmu2shylfj6kqeq269cslwz49y");
console.log("address decode:", a?.constructor?.name, Object.keys(a ?? {}));
