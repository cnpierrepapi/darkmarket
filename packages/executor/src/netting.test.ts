import { expect, test } from "bun:test";
import { netOff, shieldedFraction, type Aggregate } from "./netting.ts";

const agg = (yes: bigint, no: bigint): Aggregate => ({
  marketId: "fed-sept-2026",
  yesNotional: yes,
  noNotional: no,
  participants: 5,
  epoch: 1,
});

test("a balanced epoch never reaches the market", () => {
  const r = netOff(agg(500n, 500n));
  expect(r.kind).toBe("crossed");
  expect(shieldedFraction(agg(500n, 500n))).toBe(100);
});

test("only the residual is exposed", () => {
  const r = netOff(agg(800n, 300n));
  expect(r.kind).toBe("residual");
  if (r.kind !== "residual") throw new Error("unreachable");
  expect(r.side).toBe("YES");
  expect(r.size).toBe(500n);
  expect(r.crossed).toBe(300n);
});

test("the NO side wins when it is larger", () => {
  const r = netOff(agg(100n, 900n));
  if (r.kind !== "residual") throw new Error("expected a residual");
  expect(r.side).toBe("NO");
  expect(r.size).toBe(800n);
});

test("shielded fraction reports what stayed private", () => {
  // 1100 submitted, 500 exposed, so 600 of it never showed up publicly.
  expect(shieldedFraction(agg(800n, 300n))).toBeCloseTo(54.54, 1);
});

test("an empty epoch does not divide by zero", () => {
  expect(shieldedFraction(agg(0n, 0n))).toBe(0);
});
