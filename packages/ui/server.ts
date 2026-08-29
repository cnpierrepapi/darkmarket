// The demo server.
//
// Holds one wallet and one joined contract open for the life of the process,
// so a click seals in seconds instead of paying the wallet-sync cost every
// time. Everything it exposes is something the page needs to tell the story:
// what you sealed, what the chain can see, and what leaks out to Polymarket.

import "./target.ts";
import "@midnightntwrk/onchain-runtime-v4";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildWalletAndWaitForFunds,
  configureMidnightNodeProviders,
  readMidnightContract,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as Contract from "@evm-midnight/midnight-contract/contract";
import { netOff, shieldedFraction, type Aggregate } from "./netting.ts";
import { resolveMarket, buildOrder } from "./polymarket.ts";

const NETWORK = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
const PORT = Number(process.env.PORT ?? 4000);
const CONDITION_ID = process.env.DARKMARKET_CONDITION_ID ??
  "0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a";
const FLOOR = 5;

const hex32 = (h: string): Uint8Array =>
  new Uint8Array(Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex"));
const toHex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);

const address = process.argv[2] ?? readMidnightContract("contract-round-value", { networkId: NETWORK }).contractAddress;
if (!address) throw new Error("no contract address");

console.log(`[darkmarket] network ${NETWORK}, contract ${address}`);
console.log("[darkmarket] building wallet, this is the slow part...");

const net = midnightNetworkConfig;
const urls = { id: net.id, indexer: net.indexer, indexerWS: net.indexerWS, node: net.node, proofServer: net.proofServer };
const contractData = readMidnightContract("contract-round-value", { networkId: NETWORK });

const w = await buildWalletAndWaitForFunds(urls as never, net.walletSeed!, NETWORK as never);
const providers = await configureMidnightNodeProviders(
  w.wallet, w.zswapSecretKeys, w.walletZswapSecretKeys, w.dustSecretKey, w.walletDustSecretKey,
  urls as never, "darkmarket-private-state", contractData.zkConfigPath, w.unshieldedKeystore,
);
const compiled = CompiledContract.make("contract-round-value", Contract.Contract).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets("./"),
);
const dm = await findDeployedContract(providers, {
  contractAddress: address,
  compiledContract: compiled as never,
  privateStateId: "darkmarketPrivateState",
  initialPrivateState: {},
});
console.log("[darkmarket] contract joined, ready");

// Intents live here and nowhere else until the epoch closes. This is the whole
// point of the design, so the server keeps them in memory and never writes them
// anywhere the chain or the page can read back.
type Local = { side: boolean; size: bigint; blind: Uint8Array; commitment: string };
let pending: Local[] = [];
let busy = false;

const readChain = async () => {
  const state = await providers.publicDataProvider.queryContractState(address);
  const l = Contract.ledger(state!.data);
  return {
    conditionId: isZero(l.condition_id) ? "" : toHex(l.condition_id),
    sealed: Number(l.pending),
    participants: Number(l.participants),
    yes: l.yes_notional.toString(),
    no: l.no_notional.toString(),
    epoch: Number(l.epoch),
    calls: Number(l.round),
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/" || p === "/index.html") {
      return new Response(readFileSync(`${import.meta.dir}/public/index.html`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (p === "/api/state") {
      const chain = await readChain();
      const agg: Aggregate = {
        conditionId: chain.conditionId || CONDITION_ID,
        yesNotional: BigInt(chain.yes),
        noNotional: BigInt(chain.no),
        participants: chain.participants,
        epoch: chain.epoch,
      };
      const residual = netOff(agg);
      return json({
        contract: address,
        network: NETWORK,
        floor: FLOOR,
        chain,
        // only the shapes, never the sizes
        localCommitments: pending.map((x) => x.commitment),
        residual: {
          kind: residual.kind,
          crossed: residual.crossed.toString(),
          side: residual.kind === "residual" ? residual.side : null,
          size: residual.kind === "residual" ? residual.size.toString() : "0",
        },
        shielded: shieldedFraction(agg),
        busy,
      });
    }

    if (p === "/api/seal" && req.method === "POST") {
      if (busy) return json({ error: "busy" }, 409);
      const { side, size } = (await req.json()) as { side: boolean; size: number };
      if (!Number.isFinite(size) || size <= 0) return json({ error: "size must be positive" }, 400);
      busy = true;
      try {
        const blind = new Uint8Array(randomBytes(32));
        const c = Contract.pureCircuits.intent_commitment(!!side, BigInt(Math.floor(size)), blind);
        const tx = await dm.callTx.commit_intent(hex32(CONDITION_ID), c);
        const commitment = toHex(c);
        pending.push({ side: !!side, size: BigInt(Math.floor(size)), blind, commitment });
        return json({ ok: true, commitment, block: Number(tx.public.blockHeight) });
      } catch (e: any) {
        return json({ error: String(e?.message ?? e).slice(0, 300) }, 500);
      } finally {
        busy = false;
      }
    }

    if (p === "/api/close" && req.method === "POST") {
      if (busy) return json({ error: "busy" }, 409);
      if (pending.length < FLOOR) {
        return json({ error: `the circuit will refuse: ${pending.length} of ${FLOOR} sealed` }, 400);
      }
      busy = true;
      try {
        const five = pending.slice(0, FLOOR);
        const tx = await dm.callTx.close_epoch(
          five.map((x) => x.side),
          five.map((x) => x.size),
          five.map((x) => x.blind),
        );
        pending = pending.slice(FLOOR);
        return json({ ok: true, block: Number(tx.public.blockHeight) });
      } catch (e: any) {
        return json({ error: String(e?.message ?? e).slice(0, 300) }, 500);
      } finally {
        busy = false;
      }
    }

    if (p === "/api/order") {
      const chain = await readChain();
      const agg: Aggregate = {
        conditionId: chain.conditionId || CONDITION_ID,
        yesNotional: BigInt(chain.yes),
        noNotional: BigInt(chain.no),
        participants: chain.participants,
        epoch: chain.epoch,
      };
      const residual = netOff(agg);
      if (residual.kind === "crossed") return json({ crossed: true, market: null, order: null });
      try {
        const market = await resolveMarket(agg.conditionId);
        return json({ crossed: false, market, order: buildOrder(residual, market) });
      } catch (e: any) {
        return json({ error: String(e?.message ?? e).slice(0, 200) }, 502);
      }
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`[darkmarket] http://localhost:${PORT}`);
