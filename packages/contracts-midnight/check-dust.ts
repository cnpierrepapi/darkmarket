// Is the preprod wallet funded? Answered straight from the indexer, without a
// wallet sync, because the sync takes an hour and dies halfway.
//
// graphql-transport-ws: connection_init, wait for ack, subscribe, read.
import { existsSync, readFileSync } from "node:fs";

const readEnv = (key: string): string | undefined => {
  for (const f of [".env.local", "/app/.env.local", "../../.env.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0 && line.slice(0, at).trim() === key) {
        return line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
};

const address = process.argv[2] ?? readEnv("MIDNIGHT_WALLET_ADDRESS");
const net = process.env.MIDNIGHT_NETWORK_ID ?? "preprod";
const url = `wss://indexer.${net}.midnight.network/api/v4/graphql/ws`;
if (!address) { console.error("no address"); process.exit(1); }

console.log(`address: ${address}`);
console.log(`indexer: ${url}`);
console.log("");

const ws = new WebSocket(url, "graphql-transport-ws");
let created = 0, spent = 0, txs = 0;
const seen: string[] = [];

const done = (why: string) => {
  console.log("");
  console.log(`transactions seen: ${txs}`);
  console.log(`utxos created:     ${created}`);
  console.log(`utxos spent:       ${spent}`);
  console.log("");
  console.log(created > 0
    ? "FUNDED. this address has received value on " + net + "."
    : "NO INBOUND VALUE FOUND. this address looks unfunded on " + net + ".");
  if (seen.length) console.log("sample:", seen.slice(0, 3).join(" | "));
  console.log(`(${why})`);
  try { ws.close(); } catch {}
  process.exit(0);
};

const timer = setTimeout(() => done("timed out after 45s"), 45000);

ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init", payload: {} }));
ws.onerror = (e: any) => { console.error("ws error:", e?.message ?? e); clearTimeout(timer); done("socket error"); };
ws.onclose = () => { clearTimeout(timer); done("socket closed"); };
ws.onmessage = (ev: any) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === "connection_ack") {
    ws.send(JSON.stringify({
      id: "1", type: "subscribe",
      payload: {
        query: `subscription($a: DustAddress!) {
          dustGenerations(dustAddress: $a) {
            __typename
          }
        }`,
        variables: { a: address },
      },
    }));
    return;
  }
  if (msg.type === "next") {
    const d = msg.payload?.data?.unshieldedTransactions;
    if (d?.createdUtxos || d?.spentUtxos) {
      txs++;
      created += (d.createdUtxos ?? []).length;
      spent += (d.spentUtxos ?? []).length;
      for (const u of d.createdUtxos ?? []) seen.push(`+${u.value}`);
    }
    return;
  }
  if (msg.type === "error") {
    console.error("graphql error:", JSON.stringify(msg.payload).slice(0, 300));
    clearTimeout(timer); done("graphql error");
  }
  if (msg.type === "complete") { clearTimeout(timer); done("stream complete"); }
};
