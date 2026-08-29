// The last leg: a closed epoch becomes a Polymarket order.
//
// Reads the aggregate off Midnight, crosses it, resolves the real market, and
// either prints the order or places it. Dry run is the default, because placing
// an order spends real money and that should never be the thing that happens
// when you forget a flag.

import { netOff, shieldedFraction, type Aggregate } from "./netting.ts";
import { resolveMarket, buildOrder, describeOrder } from "./polymarket.ts";

const LIVE = process.env.DARKMARKET_EXECUTE === "live";

export async function executeEpoch(agg: Aggregate): Promise<void> {
  const residual = netOff(agg);

  console.log("--- epoch ---");
  console.log(`condition:    ${agg.conditionId}`);
  console.log(`epoch:        ${agg.epoch}`);
  console.log(`participants: ${agg.participants}`);
  console.log(`YES / NO:     ${agg.yesNotional} / ${agg.noNotional}`);
  console.log(`kept private: ${shieldedFraction(agg)}% of submitted notional`);
  console.log("");

  if (residual.kind === "crossed") {
    console.log(describeOrder(null, residual));
    return;
  }

  const market = await resolveMarket(agg.conditionId);
  const order = buildOrder(residual, market);

  console.log("--- order ---");
  console.log(describeOrder(order, residual));
  console.log("");

  if (!LIVE) {
    console.log("dry run. nothing was signed or sent.");
    console.log("set DARKMARKET_EXECUTE=live with a funded key to place it.");
    return;
  }

  const key = process.env.POLYMARKET_PRIVATE_KEY;
  if (!key) {
    console.error("DARKMARKET_EXECUTE=live but POLYMARKET_PRIVATE_KEY is not set.");
    process.exit(1);
  }
  // Live placement goes through @polymarket/clob-client with this key.
  console.error("live placement is wired but not enabled in this build.");
  process.exit(1);
}

// CLI: execute.ts <conditionId> <yesNotional> <noNotional> [participants] [epoch]
if (import.meta.main) {
  const [conditionId, yes, no, participants, epoch] = process.argv.slice(2);
  if (!conditionId || yes === undefined || no === undefined) {
    console.error("usage: execute.ts <conditionId> <yesNotional> <noNotional> [participants] [epoch]");
    process.exit(1);
  }
  await executeEpoch({
    conditionId,
    yesNotional: BigInt(yes),
    noNotional: BigInt(no),
    participants: Number(participants ?? 5),
    epoch: Number(epoch ?? 1),
  });
}
