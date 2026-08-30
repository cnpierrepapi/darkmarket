// What dust does this address actually have?
//
// Asked straight to the indexer, not through a wallet sync. The wallet needs a
// full chain scan before it can answer, and on preprod that scan has not once
// completed for us, so every answer it gave was "0" meaning "I do not know yet"
// rather than "there is none".
//
// A DustGenerationsItem carries value and backingNight. If items come back,
// the NIGHT is generating dust and the only problem is the wallet's scan.

const NET = process.env.MIDNIGHT_NETWORK_ID ?? "preprod";
const WS = process.env.MIDNIGHT_INDEXER_WS ??
  `wss://indexer.${NET}.midnight.network/api/v4/graphql/ws`;
const dustAddress = process.argv[2];
if (!dustAddress) {
  console.error("usage: dust-truth.ts <mn_dust_...>");
  process.exit(1);
}

console.log(`dust address: ${dustAddress}`);
console.log(`indexer:      ${WS}`);
console.log("");

const ws = new WebSocket(WS, "graphql-transport-ws");
let items = 0;
let total = 0n;
const samples: string[] = [];

const done = (why: string) => {
  console.log("");
  console.log(`generation items: ${items}`);
  console.log(`total dust value: ${total}`);
  if (samples.length) console.log(`samples: ${samples.slice(0, 4).join(", ")}`);
  console.log("");
  console.log(
    items > 0
      ? "DUST EXISTS. The NIGHT is generating; the wallet scan is the problem, not the balance."
      : "NO DUST GENERATION for this address. Registered NIGHT is not producing dust.",
  );
  console.log(`(${why})`);
  try { ws.close(); } catch { /* already closing */ }
  process.exit(0);
};

const timer = setTimeout(() => done("40s window"), 40000);

ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init", payload: {} }));
ws.onerror = (e: unknown) => {
  console.error("ws error:", String((e as { message?: string })?.message ?? e).slice(0, 120));
  clearTimeout(timer);
  done("socket error");
};
ws.onclose = () => { clearTimeout(timer); done("socket closed"); };
ws.onmessage = (ev: MessageEvent) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === "connection_ack") {
    ws.send(JSON.stringify({
      id: "1",
      type: "subscribe",
      payload: {
        query: `subscription($a: DustAddress!) {
          dustGenerations(dustAddress: $a) {
            __typename
            ... on DustGenerationsItem { value initialValue ctime owner }
            ... on DustGenerationsProgress { highestIndex }
          }
        }`,
        variables: { a: dustAddress },
      },
    }));
    return;
  }
  if (msg.type === "next") {
    const d = msg.payload?.data?.dustGenerations;
    if (d?.__typename === "DustGenerationsItem") {
      items++;
      try { total += BigInt(d.value ?? "0"); } catch { /* non numeric */ }
      if (samples.length < 6) samples.push(String(d.value));
    }
    return;
  }
  if (msg.type === "error") {
    console.error("graphql error:", JSON.stringify(msg.payload).slice(0, 260));
    clearTimeout(timer);
    done("graphql error");
  }
  if (msg.type === "complete") { clearTimeout(timer); done("stream complete"); }
};
