// Deploy the DARKMARKET circuit to Midnight preprod.
//
// preprod-env MUST be imported first: it sets every environment variable the
// SDK reads, and the SDK freezes its network config at import time.

import "./preprod-env.ts";
import "@midnightntwrk/onchain-runtime-v4";

import { deployMidnightContract } from "@effectstream/midnight-contracts/deploy";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import type { DeployConfig } from "@effectstream/midnight-contracts/types";
import { Counter, witnesses } from "./contract-round-value/src/index.original.ts";

const network = midnightNetworkConfig;
// the exported config calls this field `id`, not `networkId`
if (network.id !== process.env.MIDNIGHT_NETWORK_ID) {
  console.error(
    `refusing to deploy: SDK resolved id=${network.id} but we asked for ${process.env.MIDNIGHT_NETWORK_ID}.`,
  );
  process.exit(1);
}
console.log("resolved network:", network.id, "node:", network.node);

const config: DeployConfig = {
  contractName: "contract-round-value",
  contractFileName: "darkmarket.json",
  contractClass: Counter.Contract,
  witnesses,
  privateStateId: "darkmarketPrivateState",
  initialPrivateState: {},
  privateStateStoreName: "darkmarket-private-state",
};

deployMidnightContract(config, network)
  .then(() => {
    console.log("deployed");
    process.exit(0);
  })
  .catch((e: unknown) => {
    console.error("deploy failed:", e);
    process.exit(1);
  });
