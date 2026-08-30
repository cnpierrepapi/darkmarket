// Deploy the DARKMARKET circuit. MIDNIGHT_NETWORK_ID picks the target:
// "undeployed" for the local stack, "preprod" for the public testnet.
//
// midnight-target MUST be imported first: it sets every environment variable the
// SDK reads, and the SDK freezes its network config at import time.

import "./midnight-target.ts";
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
  // readMidnightContract looks up by contract name, so the file has to be
  // named for the contract, not for the project.
  contractFileName: "contract-round-value.json",
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
