# Recording the demo

Two minutes, and the hackathon has to be named in the first line.

The interface is the demo. It is at `http://localhost:4000` and it exists to show
one thing: five people put money in, and the chain learns two numbers.

## Before you hit record

The stack takes a few minutes to come up and the first wallet sync is the slow
part, so get all of this green before the camera is on.

```
docker run -d --name dm -p 4000:4000 darkmarket \
  bunx orchestrator start --config start.midnight-only.ts
```

Wait for the proof server, then deploy and keep the address:

```
docker exec dm bash -c 'cd /app/packages/contracts-midnight && \
  MIDNIGHT_NETWORK_ID=undeployed bun run deploy-midnight.ts'
```

Start the interface with that address. It builds a wallet once at boot, which is
why a click later is fast:

```
docker exec -d dm bash -c 'cd /app/packages/contracts-midnight && \
  MIDNIGHT_NETWORK_ID=undeployed PORT=4000 bun run server.ts <address>'
```

Wait for `contract joined, ready` in its log before you open the page.

## The shots

**1. An empty pool.** Open the page. YES and NO both read zero, nothing is
sealed, the epoch is zero. Say that this is a fresh contract on Midnight and
the right side of the screen is everything the chain can see.

**2. Seal one.** Pick YES, type 500, click seal. Point at the commitment that
appears. That is what the chain got: 32 bytes that reveal nothing and cannot
be reversed. Your 500 never left the machine.

**3. Try to close early.** The close button is disabled and the note says why.
Worth saying out loud that this is not the interface being careful. The floor
is an assert inside the circuit, so an under-filled epoch cannot be proven at
all and there is no transaction to send.

**4. Fill the epoch.** Seal four more: NO 100, YES 200, NO 200, YES 100. Each
one is a real transaction with a real proof, and each adds another opaque
commitment to the list.

**5. Close it.** The one that matters. Five openings proven in a single call,
and the right side of the screen changes: YES 800, NO 300, five participants.
Five people put in 1100 between them and the chain knows two numbers.

**6. The crossing bar.** 300 of the YES matched against 300 of the NO inside
the pool. Four people traded with each other and Polymarket will never hear
about it. Only 500 is public. The big number reads 54.54% kept private.

**7. The real market.** The Polymarket card is a live price from a live book,
with the real token id, for the Fed September rates market. Say plainly that
the order is computed and not signed, because live placement needs a funded
key and this is a hackathon.

## The line worth rehearsing

Every prediction market makes you show your hand before you get filled. This one
does not, and the only thing it costs is that people who wanted opposite sides
of the same bet found each other before the market did.

## If it breaks

Everything except the Polymarket card runs locally, so a network wobble only
affects step 7.

If the chain misbehaves, start over. It is faster than debugging on camera.

The preprod contract is the fallback for "is this real":

```
92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

That one is on a public testnet and anyone can read it with
`packages/executor/src/ledger-read.ts` from the `stack-1x` branch.

## Numbers from a real run

Sealed in blocks 23 through 39, closed in block 43:

```
YES 800  NO 300  participants 5
crossed internally  300
sent to Polymarket  500 YES
kept private        54.54%
order               buy YES @ 0.545, 500 USDC, ~917 shares
```
