// Turn a closed epoch's residual into a Polymarket order.
//
// Two modes. Dry run resolves the real market, reads the real book, and prints
// the exact order it would place, signing nothing. Live mode needs a funded
// signing key and actually posts it.
//
// The split is deliberate: everything except the final signature is identical
// between the two, so a dry run is a genuine rehearsal rather than a mock.

import type { Residual } from "./netting.ts";

const GAMMA = "https://gamma-api.polymarket.com";

export type Market = {
  slug: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
};

export type Order = {
  tokenId: string;
  side: "BUY";
  outcome: "YES" | "NO";
  // Polymarket prices are probabilities in (0,1); size is in USDC.
  price: number;
  sizeUsdc: number;
  shares: number;
  market: string;
};

export async function resolveMarket(slug: string): Promise<Market> {
  const res = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`gamma ${res.status} for slug ${slug}`);
  const rows = (await res.json()) as any[];
  const m = rows?.[0];
  if (!m) throw new Error(`no market found for slug ${slug}`);

  const tokenIds = JSON.parse(m.clobTokenIds ?? "[]") as string[];
  const prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
  if (tokenIds.length < 2) throw new Error(`market ${slug} has no clob token ids`);

  return {
    slug: m.slug,
    question: m.question,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    yesPrice: prices[0],
    noPrice: prices[1],
  };
}

// A residual is always a buy of one side. Buying NO is how you express a short
// on YES here, so there is no sell path to worry about.
export function buildOrder(residual: Residual, market: Market): Order | null {
  if (residual.kind === "crossed") return null;

  const isYes = residual.side === "YES";
  const price = isYes ? market.yesPrice : market.noPrice;
  const sizeUsdc = Number(residual.size);

  return {
    tokenId: isYes ? market.yesTokenId : market.noTokenId,
    side: "BUY",
    outcome: residual.side,
    price,
    sizeUsdc,
    // shares you get for the notional at that probability
    shares: price > 0 ? Number((sizeUsdc / price).toFixed(2)) : 0,
    market: market.slug,
  };
}

export function describeOrder(order: Order | null, residual: Residual): string {
  if (!order || residual.kind === "crossed") {
    return `epoch crossed fully at ${residual.crossed}. nothing sent to Polymarket.`;
  }
  return [
    `market:  ${order.market}`,
    `buy:     ${order.outcome} @ ${order.price}`,
    `size:    ${order.sizeUsdc} USDC  (~${order.shares} shares)`,
    `token:   ${order.tokenId.slice(0, 18)}...`,
    `crossed: ${residual.crossed} never reached the market`,
  ].join("\n");
}
