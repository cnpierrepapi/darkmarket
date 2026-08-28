// What a dark pool actually does.
//
// An epoch closes with a YES total and a NO total. Those two sides cancel each
// other out inside the pool before anything is sent anywhere. Only the residual
// reaches Polymarket, so the public tape sees one order for the difference
// rather than every intent that made it up.
//
// A balanced epoch nets to nothing and never touches the market at all, which
// is the strongest privacy case and also the cheapest one.

export type Aggregate = {
  marketId: string;
  yesNotional: bigint;
  noNotional: bigint;
  participants: number;
  epoch: number;
};

export type Residual =
  | { kind: "crossed"; marketId: string; crossed: bigint; epoch: number }
  | {
      kind: "residual";
      marketId: string;
      side: "YES" | "NO";
      size: bigint;
      crossed: bigint;
      epoch: number;
    };

export function netOff(agg: Aggregate): Residual {
  const { yesNotional: yes, noNotional: no } = agg;
  const crossed = yes < no ? yes : no;

  if (yes === no) {
    return { kind: "crossed", marketId: agg.marketId, crossed, epoch: agg.epoch };
  }

  const side = yes > no ? "YES" : "NO";
  const size = yes > no ? yes - no : no - yes;

  return { kind: "residual", marketId: agg.marketId, side, size, crossed, epoch: agg.epoch };
}

// How much of the epoch never became public, as a percentage of what was
// submitted. Worth showing in the UI, since it is the number that makes the
// case for the whole design.
export function shieldedFraction(agg: Aggregate): number {
  const total = agg.yesNotional + agg.noNotional;
  if (total === 0n) return 0;
  const r = netOff(agg);
  const exposed = r.kind === "crossed" ? 0n : r.size;
  return Number(((total - exposed) * 10000n) / total) / 100;
}
