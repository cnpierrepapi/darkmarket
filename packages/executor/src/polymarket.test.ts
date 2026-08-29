import { expect, test } from "bun:test";
import { buildOrder, describeOrder, type Market } from "./polymarket.ts";
import { netOff, type Aggregate } from "./netting.ts";

const market: Market = {
  slug: "fed-sept-2026",
  question: "Will there be no change in Fed interest rates?",
  yesTokenId: "5615282760875985231868508008056959876238536896643315063916840237042205273721",
  noTokenId: "9705092100000000000000000000000000000000000000000000000000000000000000000000",
  yesPrice: 0.485,
  noPrice: 0.515,
};

const agg = (yes: bigint, no: bigint): Aggregate => ({
  marketId: "fed-sept-2026", yesNotional: yes, noNotional: no, participants: 5, epoch: 1,
});

test("a crossed epoch produces no order at all", () => {
  const r = netOff(agg(500n, 500n));
  expect(buildOrder(r, market)).toBeNull();
  expect(describeOrder(null, r)).toContain("nothing sent to Polymarket");
});

test("the residual buys the heavier side at its own price", () => {
  const r = netOff(agg(800n, 300n));
  const o = buildOrder(r, market)!;
  expect(o.outcome).toBe("YES");
  expect(o.tokenId).toBe(market.yesTokenId);
  expect(o.price).toBe(0.485);
  expect(o.sizeUsdc).toBe(500);
});

test("a NO residual uses the NO token and NO price", () => {
  const r = netOff(agg(100n, 900n));
  const o = buildOrder(r, market)!;
  expect(o.outcome).toBe("NO");
  expect(o.tokenId).toBe(market.noTokenId);
  expect(o.price).toBe(0.515);
  expect(o.sizeUsdc).toBe(800);
});

test("shares follow from notional over probability", () => {
  const r = netOff(agg(800n, 300n));
  const o = buildOrder(r, market)!;
  // 500 USDC at 0.485 buys about 1030 shares
  expect(o.shares).toBeCloseTo(1030.93, 1);
});
