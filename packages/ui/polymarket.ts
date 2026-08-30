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
  conditionId: string;
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
  conditionId: string;
};

// Look markets up by conditionId, which is what the chain stores.
//
// The query parameter is `condition_ids`. Note that `conditionId` is NOT
// rejected by the API, it is silently ignored, and you get back an unrelated
// market with a straight face. That is a genuinely nasty way to lose an hour.
export async function resolveMarket(conditionId: string): Promise<Market> {
  const res = await fetch(`${GAMMA}/markets?condition_ids=${encodeURIComponent(conditionId)}`);
  if (!res.ok) throw new Error(`gamma ${res.status} for condition ${conditionId}`);
  const rows = (await res.json()) as any[];
  const m = rows?.[0];
  if (!m) throw new Error(`no market found for conditionId ${conditionId}`);
  if (m.conditionId && m.conditionId.toLowerCase() !== conditionId.toLowerCase()) {
    throw new Error(`gamma returned ${m.conditionId} for ${conditionId}; refusing to trade the wrong market`);
  }

  const tokenIds = JSON.parse(m.clobTokenIds ?? "[]") as string[];
  const prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
  if (tokenIds.length < 2) throw new Error(`market ${slug} has no clob token ids`);

  return {
    conditionId: m.conditionId,
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
    conditionId: market.conditionId,
  };
}

export function describeOrder(order: Order | null, residual: Residual): string {
  if (!order || residual.kind === "crossed") {
    return `epoch crossed fully at ${residual.crossed}. nothing sent to Polymarket.`;
  }
  return [
    `market:  ${order.market}`,
    `id:      ${order.conditionId}`,
    `buy:     ${order.outcome} @ ${order.price}`,
    `size:    ${order.sizeUsdc} USDC  (~${order.shares} shares)`,
    `token:   ${order.tokenId.slice(0, 18)}...`,
    `crossed: ${residual.crossed} never reached the market`,
  ].join("\n");
}


/**
 * A handful of live markets for the front page.
 *
 * Ordered by 24h volume, because a dark pool is only interesting where there is
 * something to hide inside. Only markets with two outcomes and real clob token
 * ids are usable here.
 */
export async function listMarkets(limit = 12): Promise<Market[]> {
  const url = `${GAMMA}/markets?limit=${limit * 3}&closed=false&active=true` +
    `&order=volume24hr&ascending=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gamma ${res.status} listing markets`);
  const rows = (await res.json()) as any[];

  const out: Market[] = [];
  for (const m of rows) {
    try {
      const tokenIds = JSON.parse(m.clobTokenIds ?? "[]") as string[];
      const prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number);
      if (tokenIds.length < 2 || prices.length < 2) continue;
      if (!m.conditionId) continue;

      // Skip anything already decided. Volume ordering surfaces finished
      // matches sitting at 0/100, and there is nothing to hide in a market
      // whose answer is known.
      const y = prices[0];
      if (!Number.isFinite(y) || y <= 0.05 || y >= 0.95) continue;
      out.push({
        conditionId: m.conditionId,
        slug: m.slug,
        question: m.question,
        yesTokenId: tokenIds[0],
        noTokenId: tokenIds[1],
        yesPrice: prices[0],
        noPrice: prices[1],
      });
      if (out.length >= limit) break;
    } catch {
      // a malformed row is not worth failing the whole list for
    }
  }
  return out;
}
