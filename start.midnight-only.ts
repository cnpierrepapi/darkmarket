// Chain, indexer and proof server only.
//
// The stock start.dev.ts deploys the contract during boot, and on a fresh chain
// that fails with "could not balance dust" because no dust has accrued yet to
// pay the fee. The orchestrator treats that as critical and tears the whole
// stack down, so the chain never gets the chance to produce the dust it needed.
//
// This brings up the chain and lets the deploy happen separately, once there is
// something to pay with.

import path from "node:path";
import type { OrchestratorConfig } from "@effectstream/orchestrator/config";
import { launchMidnight, MidnightNames } from "@effectstream/orchestrator/launch-midnight";

const root = import.meta.dirname!;

export default {
  processes: [
    {
      name: "midnight-contract-compile",
      description: "Compile the DARKMARKET circuit",
      cwd: path.join(root, "packages/contracts-midnight/contract-round-value"),
      args: ["run", "compact"],
      waitToExit: true,
      critical: true,
    },
    ...launchMidnight(
      "@evm-midnight/contracts-midnight",
      { cwd: path.join(root, "packages/contracts-midnight") },
      {
        env: { MIDNIGHT_STORAGE_PASSWORD: "YourPasswordMy1!" },
        dependsOn: ["midnight-contract-compile"],
      },
    ).filter((p: { name: string }) => p.name !== MidnightNames.CONTRACT_DEPLOY),
  ],
} satisfies OrchestratorConfig;
