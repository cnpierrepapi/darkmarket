# Recording the demo

Two minutes, and the hackathon has to be named in the first line. What follows
is the shortest path to showing the thing that matters, which is that the chain
learns two numbers and never learns yours.

## Before you hit record

Start the stack fresh. The local chain takes a few minutes to produce enough
dust to pay for a deploy, and you do not want that happening on camera.

```
docker run -d --name dm darkmarket bunx orchestrator start --config start.midnight-only.ts
```

Wait for the proof server, then deploy and note the address:

```
docker exec dm bash -c 'cd /app/packages/contracts-midnight && \
  MIDNIGHT_NETWORK_ID=undeployed bun run deploy-midnight.ts'
```

## The shots, in order

**1. Nothing up my sleeve.** Read the freshly deployed contract. Every field is
zero. Say out loud that this reads the public ledger with no wallet and no keys,
so it is what anyone watching the chain can see.

```
docker exec dm bash -c 'cd /app/packages/contracts-midnight && \
  MIDNIGHT_NETWORK_ID=undeployed bun run ledger-read.ts <address>'
```

**2. Five people commit.** Run the epoch driver. It seals five intents, one
transaction each, then opens all five in a single call.

```
docker exec dm bash -c 'cd /app/packages/contracts-midnight && \
  MIDNIGHT_NETWORK_ID=undeployed bun run run-epoch.ts <address>'
```

The line to point at while it runs is the sealed one:

```
1/5 sealed  commitment=537b608a661639dc...  block 788
```

That commitment is the whole of what the chain gets during the sealed phase.
It is not an encrypted size that someone could crack later. It is a hash, and
the size never left the machine that made it.

**3. The reveal.** Read the ledger again, same command as shot 1. Now it shows
YES 800, NO 300, five participants. Five people put in 1100 between them and
the chain knows two numbers.

Then say the part that sells it: 300 of the YES was matched against 300 of the
NO inside the pool. Those four people traded with each other and Polymarket
will never hear about it.

**4. The leftover goes to a real market.** 

```
docker exec dm bash -c 'cd /tmp/pm && bun run execute.ts \
  0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a 800 300'
```

Live prices from Polymarket, real token id, real market. It buys 500 of YES and
nothing else, and reports that 54.54% of the money never became public.

**5. Say what is not there.** The order is computed and not signed. Be straight
about it on camera rather than letting a judge find it.

## The one line worth rehearsing

Every prediction market makes you show your hand before you are filled. This one
does not, and the only thing it costs is that four people who wanted opposite
sides of the same bet found each other before the market did.

## If something breaks on camera

The local chain and the deploy are the fragile parts, and both are fixed by
starting over. Nothing in the demo depends on the network being up except
step 4, which needs Polymarket's API.

The preprod contract is a fallback for the "is this real" question:

```
92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

That is on a public testnet and anyone can read it, though the epoch on it may
still be empty depending on when you record.
