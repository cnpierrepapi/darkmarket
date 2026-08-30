// DARKMARKET backend.
//
// Five funded Midnight wallets, each with its own key, its own database and its
// own balance. A wallet opens a position and what reaches the chain is a
// commitment: 32 bytes revealing neither side nor size, sitting there publicly
// and timestamped by its block.
//
// A position leaves that state one of two ways. Another wallet matches it, and
// both open together in a single proof that checks they take opposite sides.
// Or nobody here will take the other side, and liquidity on Polygon covers it
// instead, which leaves a transaction on Polygonscan.
//
// Wallets are built and synced once at boot, which is slow and is why this
// cannot be a serverless function. After that a click is proving and nothing
// else.

import "./target.ts";
import "@midnightntwrk/onchain-runtime-v4";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildWalletFacade,
  waitForDustFunds,
  registerNightForDust,
  suspendAuxWalletSyncForFees,
  configureMidnightNodeProviders,
  midnightNetworkConfig,
} from "@effectstream/midnight-contracts";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as Contract from "@evm-midnight/midnight-contract/contract";
import { resolveMarket } from "./polymarket.ts";
import { settleOnPolygon, evmConfig, type SettleResult } from "./evm.ts";
import { allSeeds, allSeedsFromMaster, readLocalEnv, PARTICIPANTS } from "./participants.ts";

const NETWORK = process.env.MIDNIGHT_NETWORK_ID ?? "undeployed";
const PORT = Number(process.env.PORT ?? 8080);
const CONDITION_ID = process.env.DARKMARKET_CONDITION_ID ??
  "0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a";

const hex32 = (h: string) => new Uint8Array(Buffer.from(h.replace(/^0x/, ""), "hex"));
const toHex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
const isZero = (b: Uint8Array) => b.every((x) => x === 0);

const log: string[] = [];
const say = (s: string) => {
  log.push(`${new Date().toISOString().slice(11, 19)}  ${s}`);
  if (log.length > 300) log.shift();
  console.log("[darkmarket]", s);
};

const isLocal = NETWORK === "undeployed";
const mnemonic = readLocalEnv("MIDNIGHT_WALLET_MNEMONIC");
if (!mnemonic && !isLocal) throw new Error("no MIDNIGHT_WALLET_MNEMONIC");

// Deliberately mutable and deliberately optional. A host will kill a container
// that has not bound its port within a few minutes, and bringing up a chain and
// deploying a circuit takes longer than that. So the server listens first and
// the slow work happens behind it.
let address = process.argv[2] ?? process.env.DARKMARKET_CONTRACT ?? "";

const zkConfigPath = process.env.DARKMARKET_ZK_CONFIG ??
  "/app/packages/contracts-midnight/contract-round-value/src/managed";

// deploy-midnight.ts sits beside this file, but it resolves the contract record
// relative to its own directory, so it runs from the contracts package.
const deployCwd = process.env.DARKMARKET_DEPLOY_CWD ?? "/app/packages/contracts-midnight";

const net = midnightNetworkConfig;
const urls = {
  id: net.id, indexer: net.indexer, indexerWS: net.indexerWS,
  node: net.node, proofServer: net.proofServer,
};
const seeds = isLocal ? allSeedsFromMaster(net.walletSeed!) : allSeeds(mnemonic!);

type Wallet = {
  index: number;
  address: string;
  contract: Awaited<ReturnType<typeof findDeployedContract>>;
};

type Position = {
  id: number;
  wallet: number;
  walletAddress: string;
  side: "YES" | "NO";
  size: number;
  commitment: string;
  blind: string;
  openedBlock: number;
  openedAt: string;
  status: "open" | "matched" | "covered";
  matchedWith?: number;
  matchedBlock?: number;
  matchedAt?: string;
  cover?: SettleResult & { at: string };
};

const wallets: (Wallet | undefined)[] = new Array(PARTICIPANTS).fill(undefined);
const readyCount = () => wallets.filter(Boolean).length;
const positions: Position[] = [];
let nextId = 1;
// The deployed vault keys settlements on a number and slot 1 is already used,
// so covers start above it.
let nextCoverSlot = Number(process.env.EVM_START_SLOT ?? "2");
let booting = true;
let busy = false;
let bootError: string | null = null;

const ownPrivateState = (index: number, coinPublicKey: Uint8Array) =>
  levelPrivateStateProvider({
    midnightDbName: `midnight-level-db-p${index}`,
    privateStateStoreName: `darkmarket-p${index}`,
    signingKeyStoreName: `darkmarket-p${index}-keys`,
    privateStoragePasswordProvider: async () =>
      process.env.MIDNIGHT_STORAGE_PASSWORD ?? "DarkMarketSeal1!",
    accountId: Buffer.from(coinPublicKey).toString("hex"),
  } as never);

const BOOT_ATTEMPTS = Number(process.env.DARKMARKET_BOOT_ATTEMPTS ?? "3");

/** Wait for the local chain's proof server and indexer, then deploy. */
const bringUpChain = async (): Promise<void> => {
  if (address) return;
  say("no contract yet, waiting for the chain");

  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch("http://127.0.0.1:6300/health");
      if (r.ok) { say(`proof server up after ${i}s`); break; }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      say(`deploying the circuit (attempt ${attempt})`);
      const proc = Bun.spawn(["bun", "run", "deploy-midnight.ts"], {
        cwd: deployCwd,
        env: { ...process.env, MIDNIGHT_NETWORK_ID: NETWORK },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const m = out.match(/Contract address: ([a-f0-9]+)/);
      if (m) {
        address = m[1];
        say(`deployed at ${address}`);
        return;
      }
      say("deploy did not land, the chain may still be generating dust");
    } catch (e: unknown) {
      say(`deploy attempt ${attempt} failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 45000));
  }
  say("gave up deploying; the page will load but nothing can trade");
};

const bootOne = async (i: number): Promise<void> => {
  // Stagger: five wallets opening databases in the same instant is how the
  // lock conflicts happened.
  await new Promise((r) => setTimeout(r, i * 2500));

  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
    try {
      say(`wallet ${i}: building (attempt ${attempt})`);
      const w = await buildWalletFacade(urls as never, seeds[i], NETWORK as never, "all");
      try {
        await registerNightForDust(w);
      } catch {
        // already registered, or nothing to register
      }
      await waitForDustFunds(w.wallet, {
        timeoutMs: Number(process.env.DARKMARKET_DUST_TIMEOUT_MS ?? 900000),
      });

      const providers = await configureMidnightNodeProviders(
        w.wallet, w.zswapSecretKeys, w.walletZswapSecretKeys, w.dustSecretKey,
        w.walletDustSecretKey, urls as never, `darkmarket-p${i}`,
        zkConfigPath, w.unshieldedKeystore,
      );
      const own = {
        ...(providers as Record<string, unknown>),
        privateStateProvider: ownPrivateState(i, w.zswapSecretKeys.coinPublicKey as never),
      } as never;

      const compiled = CompiledContract.make("contract-round-value", Contract.Contract).pipe(
        CompiledContract.withWitnesses({} as never),
        CompiledContract.withCompiledFileAssets("./"),
      );
      const contract = await findDeployedContract(own, {
        contractAddress: address,
        compiledContract: compiled as never,
        privateStateId: `darkmarket-p${i}`,
        initialPrivateState: {},
      });

      // A synced wallet keeps scanning and starves the proving. Each one only
      // needs to pay a fee from here.
      try {
        await suspendAuxWalletSyncForFees(w.wallet as never);
      } catch {
        // best effort
      }

      wallets[i] = { index: i, address: w.unshieldedAddress, contract };
      say(`wallet ${i}: ready`);
      return;
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e).slice(0, 180);
      say(`wallet ${i}: attempt ${attempt} failed, ${msg}`);
      bootError = msg;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  say(`wallet ${i}: gave up`);
};

(async () => {
  await bringUpChain();
  if (!address) { booting = false; return; }
  await Promise.all(Array.from({ length: PARTICIPANTS }, (_, i) => bootOne(i)));
  booting = false;
  say(`boot done, ${readyCount()}/${PARTICIPANTS} wallets ready`);
})();

// Reading the ledger needs no wallet, so it works while the wallets boot.
const reader = indexerPublicDataProvider(net.indexer, net.indexerWS);

const readChain = async () => {
  if (!address) {
    return { conditionId: "", opened: 0, matched: 0, matchedNotional: "0", coveredNotional: "0", calls: 0 };
  }
  const state = await reader.queryContractState(address);
  if (!state) {
    return { conditionId: "", opened: 0, matched: 0, matchedNotional: "0", coveredNotional: "0", calls: 0 };
  }
  const l = Contract.ledger(state.data);
  return {
    conditionId: isZero(l.condition_id) ? "" : toHex(l.condition_id),
    opened: Number(l.opened),
    matched: Number(l.matched),
    matchedNotional: l.matched_notional.toString(),
    coveredNotional: l.covered_notional.toString(),
    calls: Number(l.round),
  };
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

const explorerBase = process.env.EVM_EXPLORER ?? "https://amoy.polygonscan.com";

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (p === "/" || p === "/index.html") {
      return new Response(readFileSync(`${import.meta.dir}/public/index.html`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (p === "/api/state") {
      let chain = { conditionId: "", opened: 0, matched: 0, matchedNotional: "0", coveredNotional: "0", calls: 0 };
      try { chain = await readChain(); } catch { /* indexer hiccup */ }

      let market: unknown = null;
      try { market = await resolveMarket(chain.conditionId || CONDITION_ID); } catch { /* offline */ }

      return json({
        network: NETWORK,
        contract: address,
        conditionId: chain.conditionId || CONDITION_ID,
        booting, busy, bootError,
        evmReady: !!evmConfig(),
        explorer: explorerBase,
        wallets: wallets.map((w, i) =>
          w ? { index: i, address: w.address, ready: true } : { index: i, address: null, ready: false }),
        chain,
        market,
        positions,
        log: log.slice(-40),
      });
    }

    // --- open a position -------------------------------------------------
    if (p === "/api/open" && req.method === "POST") {
      if (booting) return json({ error: "wallets are still syncing" }, 409);
      if (busy) return json({ error: "another transaction is in flight" }, 409);
      const body = (await req.json()) as { wallet: number; side: "YES" | "NO"; size: number };
      const w = wallets[body.wallet];
      if (!w) return json({ error: `wallet ${body.wallet} is not ready` }, 400);
      if (!Number.isFinite(body.size) || body.size <= 0) return json({ error: "size must be positive" }, 400);

      busy = true;
      try {
        const blind = new Uint8Array(randomBytes(32));
        const side = body.side === "NO" ? false : true;
        const size = BigInt(Math.floor(body.size));
        const c = Contract.pureCircuits.position_commitment(side, size, blind);

        say(`wallet ${body.wallet} opening ${body.side} ${body.size}`);
        const tx = await w.contract.callTx.open_position(hex32(CONDITION_ID), c);
        const block = Number(tx.public.blockHeight);

        const pos: Position = {
          id: nextId++,
          wallet: body.wallet,
          walletAddress: w.address,
          side: body.side === "NO" ? "NO" : "YES",
          size: Math.floor(body.size),
          commitment: toHex(c),
          blind: toHex(blind),
          openedBlock: block,
          openedAt: new Date().toISOString(),
          status: "open",
        };
        positions.push(pos);
        say(`position ${pos.id} open, commitment ${pos.commitment.slice(0, 18)}... block ${block}`);
        return json({ ok: true, position: pos });
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        say(`open failed: ${msg}`);
        return json({ error: msg }, 500);
      } finally {
        busy = false;
      }
    }

    // --- match an open position ------------------------------------------
    if (p === "/api/match" && req.method === "POST") {
      if (booting) return json({ error: "wallets are still syncing" }, 409);
      if (busy) return json({ error: "another transaction is in flight" }, 409);
      const body = (await req.json()) as { target: number; wallet: number; size?: number };
      const target = positions.find((x) => x.id === body.target);
      if (!target) return json({ error: `no position ${body.target}` }, 404);
      if (target.status !== "open") return json({ error: `position ${target.id} is already ${target.status}` }, 400);
      const w = wallets[body.wallet];
      if (!w) return json({ error: `wallet ${body.wallet} is not ready` }, 400);
      if (body.wallet === target.wallet) return json({ error: "a wallet cannot match its own position" }, 400);

      busy = true;
      try {
        // The matching side is the opposite one, same size unless asked otherwise.
        const side = target.side === "YES" ? false : true;
        const size = BigInt(Math.floor(body.size ?? target.size));
        const blind = new Uint8Array(randomBytes(32));
        const c = Contract.pureCircuits.position_commitment(side, size, blind);

        say(`wallet ${body.wallet} opening the other side of position ${target.id}`);
        const openTx = await w.contract.callTx.open_position(hex32(CONDITION_ID), c);

        const counter: Position = {
          id: nextId++,
          wallet: body.wallet,
          walletAddress: w.address,
          side: target.side === "YES" ? "NO" : "YES",
          size: Number(size),
          commitment: toHex(c),
          blind: toHex(blind),
          openedBlock: Number(openTx.public.blockHeight),
          openedAt: new Date().toISOString(),
          status: "open",
        };
        positions.push(counter);

        say(`matching ${target.id} with ${counter.id}`);
        const matchTx = await w.contract.callTx.match_positions(
          target.side === "YES",
          BigInt(target.size),
          hex32(target.blind),
          side,
          size,
          blind,
        );
        const block = Number(matchTx.public.blockHeight);
        const at = new Date().toISOString();

        target.status = "matched";
        target.matchedWith = counter.id;
        target.matchedBlock = block;
        target.matchedAt = at;
        counter.status = "matched";
        counter.matchedWith = target.id;
        counter.matchedBlock = block;
        counter.matchedAt = at;

        say(`matched in block ${block}, nothing reaches the open market`);
        return json({ ok: true, block, target, counter });
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        say(`match failed: ${msg}`);
        return json({ error: msg }, 500);
      } finally {
        busy = false;
      }
    }

    // --- cover an open position with Polygon liquidity --------------------
    if (p === "/api/cover" && req.method === "POST") {
      if (busy) return json({ error: "another transaction is in flight" }, 409);
      const body = (await req.json()) as { position: number };
      const pos = positions.find((x) => x.id === body.position);
      if (!pos) return json({ error: `no position ${body.position}` }, 404);
      if (pos.status !== "open") return json({ error: `position ${pos.id} is already ${pos.status}` }, 400);
      if (!evmConfig()) {
        return json({ error: "no EVM config: set EVM_VAULT_ADDRESS and EVM_EXECUTOR_PRIVATE_KEY" }, 400);
      }

      busy = true;
      try {
        const slot = nextCoverSlot++;
        say(`covering position ${pos.id} on Polygon (slot ${slot})`);
        const settlement = await settleOnPolygon({
          epoch: slot,
          conditionId: CONDITION_ID,
          side: pos.side,
          size: BigInt(pos.size),
          crossed: 0n,
        });
        say(`covered on Polygon: ${settlement.txHash}`);

        // Record it on Midnight too, so both ledgers carry the same number.
        const w = wallets[pos.wallet];
        if (w) {
          try {
            await w.contract.callTx.mark_covered(
              BigInt(pos.size),
              hex32(pos.blind),
              pos.side === "YES",
            );
            say(`marked position ${pos.id} covered on Midnight`);
          } catch (e: unknown) {
            say(`could not mark covered on Midnight: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
          }
        }

        pos.status = "covered";
        pos.cover = { ...settlement, at: new Date().toISOString() };
        return json({ ok: true, position: pos });
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        say(`cover failed: ${msg}`);
        return json({ error: msg }, 500);
      } finally {
        busy = false;
      }
    }

    return new Response("not found", { status: 404 });
  },
});

say(`listening on :${PORT}, contract ${address} on ${NETWORK}`);
