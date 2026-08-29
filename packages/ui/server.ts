// DARKMARKET backend.
//
// Five separate Midnight wallets, five real addresses, five real balances.
// Each participant seals its own intent with its own key and pays its own fee,
// so "5 participants" on the ledger means five wallets and not one wallet
// counting to five.
//
// Every wallet is built and synced once at boot, which is slow and is the whole
// reason this cannot be a serverless function. After that a run is just proving
// and submitting.

import "./target.ts";
import "@midnightntwrk/onchain-runtime-v4";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildWalletFacade,
  waitForDustFunds,
  registerNightForDust,
  configureMidnightNodeProviders,
  readMidnightContract,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as Contract from "@evm-midnight/midnight-contract/contract";
import { netOff, shieldedFraction, type Aggregate } from "./netting.ts";
import { resolveMarket, buildOrder } from "./polymarket.ts";
import { allSeeds, readLocalEnv, PARTICIPANTS, INTENTS } from "./participants.ts";

const NETWORK = process.env.MIDNIGHT_NETWORK_ID ?? "preprod";
const PORT = Number(process.env.PORT ?? 8080);
const CONDITION_ID = process.env.DARKMARKET_CONDITION_ID ??
  "0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a";

const hex32 = (h: string) => new Uint8Array(Buffer.from(h.replace(/^0x/, ""), "hex"));
const toHex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
const isZero = (b: Uint8Array) => b.every((x) => x === 0);

type Participant = {
  index: number;
  address: string;
  dustAddress: string;
  contract: Awaited<ReturnType<typeof findDeployedContract>>;
  ready: boolean;
};

const log: string[] = [];
const say = (s: string) => {
  const line = `${new Date().toISOString().slice(11, 19)}  ${s}`;
  log.push(line);
  if (log.length > 200) log.shift();
  console.log("[darkmarket]", s);
};

// The contract address is passed in. readMidnightContract is only a fallback,
// because it hunts the filesystem for a record file that is written at deploy
// time and is not in the image: relying on it crashes the container at boot.
const address = process.argv[2] ?? process.env.DARKMARKET_CONTRACT ?? (() => {
  try {
    return readMidnightContract("contract-round-value", { networkId: NETWORK }).contractAddress;
  } catch {
    return undefined;
  }
})();
if (!address) throw new Error("no contract address: pass one as an argument or set DARKMARKET_CONTRACT");

const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic) throw new Error("no MIDNIGHT_WALLET_MNEMONIC");

const net = midnightNetworkConfig;
const urls = {
  id: net.id, indexer: net.indexer, indexerWS: net.indexerWS,
  node: net.node, proofServer: net.proofServer,
};
// Same for the proving keys. They ship in the image at a known path, so look
// there first and only fall back to the search.
const zkConfigPath = process.env.DARKMARKET_ZK_CONFIG ??
  "/app/packages/contracts-midnight/contract-round-value/src/managed";
const seeds = allSeeds(mnemonic);

const participants: (Participant | undefined)[] = new Array(PARTICIPANTS).fill(undefined);
const readyCount = () => participants.filter(Boolean).length;
let bootError: string | null = null;
let booting = true;
let running = false;

// Boot all five wallets at once, not one after another. A preprod sync takes
// about twenty minutes, so sequential boot would be nearly two hours of cold
// start. In parallel it is twenty minutes for all five.
//
// The sync also dies silently: the process stays alive and the stream simply
// stops. So each wallet gets its own retries rather than one failure taking
// the whole demo down.
const BOOT_ATTEMPTS = Number(process.env.DARKMARKET_BOOT_ATTEMPTS ?? "4");

const bootOne = async (i: number): Promise<void> => {
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
    try {
      say(`participant ${i}: building wallet (attempt ${attempt})`);
      // dust-only: a participant seals and pays a fee, so it needs dust and
      // nothing else. The shielded scan is the slow half of a preprod sync and
      // this skips it, along with the indexer connections it would hold open.
      const w = await buildWalletFacade(urls as never, seeds[i], NETWORK as never, "dust-only");
      say(`participant ${i}: waiting for dust`);
      try {
        await registerNightForDust(w);
      } catch (e: unknown) {
        say(`participant ${i}: dust registration skipped, ${String((e as Error)?.message ?? e).slice(0, 90)}`);
      }
      await waitForDustFunds(w.wallet, { timeoutMs: Number(process.env.DARKMARKET_DUST_TIMEOUT_MS ?? 900000) });
      const providers = await configureMidnightNodeProviders(
        w.wallet, w.zswapSecretKeys, w.walletZswapSecretKeys, w.dustSecretKey,
        w.walletDustSecretKey, urls as never, `darkmarket-p${i}`,
        zkConfigPath, w.unshieldedKeystore,
      );
      const compiled = CompiledContract.make("contract-round-value", Contract.Contract).pipe(
        CompiledContract.withWitnesses({} as never),
        CompiledContract.withCompiledFileAssets("./"),
      );
      const contract = await findDeployedContract(providers, {
        contractAddress: address,
        compiledContract: compiled as never,
        privateStateId: `darkmarket-p${i}`,
        initialPrivateState: {},
      });
      participants[i] = {
        index: i, address: w.unshieldedAddress, dustAddress: w.dustAddress,
        contract, ready: true,
      };
      say(`participant ${i}: ready at ${w.unshieldedAddress.slice(0, 24)}...`);
      return;
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e).slice(0, 200);
      say(`participant ${i}: attempt ${attempt} failed, ${msg}`);
      bootError = msg;
    }
  }
  say(`participant ${i}: gave up after ${BOOT_ATTEMPTS} attempts`);
};

(async () => {
  await Promise.all(Array.from({ length: PARTICIPANTS }, (_, i) => bootOne(i)));
  booting = false;
  say(`boot done, ${readyCount()}/${PARTICIPANTS} ready`);
})();

// Reading the ledger needs no wallet at all, so it goes through its own public
// data provider and keeps working even while the wallets are still booting.
const reader = indexerPublicDataProvider(net.indexer, net.indexerWS);

const readChain = async () => {
  const state = await reader.queryContractState(address);
  if (!state) {
    return { conditionId: "", sealed: 0, participants: 0, yes: "0", no: "0", epoch: 0, calls: 0 };
  }
  const l = Contract.ledger(state.data);
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

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      }});
    }

    if (p === "/" || p === "/index.html") {
      return new Response(readFileSync(`${import.meta.dir}/public/index.html`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (p === "/api/state") {
      let chain = { conditionId: "", sealed: 0, participants: 0, yes: "0", no: "0", epoch: 0, calls: 0 };
      try { chain = await readChain(); } catch {}
      const agg: Aggregate = {
        conditionId: chain.conditionId || CONDITION_ID,
        yesNotional: BigInt(chain.yes), noNotional: BigInt(chain.no),
        participants: chain.participants, epoch: chain.epoch,
      };
      const residual = netOff(agg);
      return json({
        network: NETWORK, contract: address, floor: PARTICIPANTS,
        booting, bootError, running,
        participants: participants.map((x, i) => x ? { index: i, address: x.address, ready: true } : { index: i, address: null, ready: false }),
        chain,
        residual: {
          kind: residual.kind, crossed: residual.crossed.toString(),
          side: residual.kind === "residual" ? residual.side : null,
          size: residual.kind === "residual" ? residual.size.toString() : "0",
        },
        shielded: shieldedFraction(agg),
        log: log.slice(-40),
      });
    }

    if (p === "/api/run" && req.method === "POST") {
      if (booting) return json({ error: "still booting wallets" }, 409);
      if (running) return json({ error: "already running" }, 409);
      if (readyCount() < PARTICIPANTS) {
        return json({ error: `only ${readyCount()} of ${PARTICIPANTS} wallets are funded and ready` }, 400);
      }
      running = true;
      const blinds: Uint8Array[] = [];
      try {
        say("--- epoch start ---");
        for (let i = 0; i < PARTICIPANTS; i++) {
          const blind = new Uint8Array(randomBytes(32));
          blinds.push(blind);
          const c = Contract.pureCircuits.intent_commitment(INTENTS[i].side, INTENTS[i].size, blind);
          say(`participant ${i} sealing`);
          const tx = await participants[i]!.contract.callTx.commit_intent(hex32(CONDITION_ID), c);
          say(`participant ${i} sealed ${toHex(c).slice(0, 18)}... block ${tx.public.blockHeight}`);
        }
        say("closing epoch, five openings in one proof");
        const tx = await participants[0]!.contract.callTx.close_epoch(
          INTENTS.map((x) => x.side), INTENTS.map((x) => x.size), blinds,
        );
        say(`closed in block ${tx.public.blockHeight}`);
        return json({ ok: true, block: Number(tx.public.blockHeight) });
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        say(`FAILED ${msg}`);
        return json({ error: msg }, 500);
      } finally {
        running = false;
      }
    }

    if (p === "/api/order") {
      const chain = await readChain();
      const agg: Aggregate = {
        conditionId: chain.conditionId || CONDITION_ID,
        yesNotional: BigInt(chain.yes), noNotional: BigInt(chain.no),
        participants: chain.participants, epoch: chain.epoch,
      };
      const residual = netOff(agg);
      // The market itself is always returned, epoch or not: the front page shows
      // live Polymarket prices before anyone has taken a position.
      try {
        const market = await resolveMarket(agg.conditionId);
        return json({
          crossed: residual.kind === "crossed",
          market,
          order: residual.kind === "crossed" ? null : buildOrder(residual, market),
        });
      } catch (e: unknown) {
        return json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, 502);
      }
    }

    return new Response("not found", { status: 404 });
  },
});

say(`listening on :${PORT}, contract ${address} on ${NETWORK}`);
