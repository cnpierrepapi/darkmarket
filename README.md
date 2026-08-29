# DARKMARKET

A dark pool for prediction markets. Take a position on Polymarket without the
market watching you take it.

Built for the MLH Midnight hackathon, 28-30 August 2026, cross-chain track.

## The problem

Put real size into a Polymarket book and it sits there in public. Your side,
your size, roughly your conviction, all readable before you are filled. People
trade against that, and the bigger your order the worse it gets.

Equities solved this decades ago with dark pools. Orders match away from the
public book, and only what fails to match goes out where everyone can see it.
Prediction markets never got one.

This is that, with the matching done in zero knowledge on Midnight and the
leftovers sent to Polymarket on Polygon.

## How it works

You seal an intent. What lands on Midnight's public ledger is a commitment,
which is noise. Nobody learns your side, your size, or that you changed your
mind twice before submitting.

When five intents are sealed, the epoch closes. One circuit call opens all five
at once, proves each one matches something that was sealed earlier, adds them
up, and writes exactly two numbers to the ledger: total YES and total NO.

Then those two cancel. An epoch with 800 of YES and 300 of NO crosses 300
internally, and Polymarket sees a single order for 500. Not eight orders. One,
for the difference. An epoch that happens to balance sends nothing at all, and
the public tape never records that anything happened.

## The part that took longest to get right

You cannot hide a size by adding it to a public total one transaction at a time.
The delta between two blocks is the size. No cryptography fixes that, and
Compact's compiler will stop you: adding a secret to a public field is the exact
thing `disclose` exists to make you admit.

Privacy only shows up once several people's intents are combined before anything
is published. Hence epochs.

And the reason the individual sizes do not leak when the epoch closes, which
looks wrong at first glance: `disclose()` is an acknowledgement to the compiler,
not an emission. Nothing is broadcast when you call it. What reaches the chain is
the ledger state after the transaction, and that state holds two totals. The five
numbers that produced them are gone.

## The floor is in the circuit

Five sealed intents minimum, enforced by an `assert` inside `close_epoch`. Not a
config value, not a check in an API layer. An under-filled epoch does not produce
a weaker proof or a warning. It fails to prove, so there is no transaction to
send.

Hiding in a crowd needs a crowd. Enforcing that anywhere but the circuit would
mean asking you to trust that we did.

## Which chain does what

Midnight holds sealed intents and does the matching. It is the privacy engine.

Polygon is where the consequence lands, because that is where Polymarket lives
and where a conditional token is real.

EffectStream sits between them, reads both, and merges them into one table.
There is no bridge, no relayer, no light client, and neither chain knows the
other exists. They share a key and the rollup does the join.

## Live

Front end: https://nightmarket.vercel.app

Backend, which holds the five wallets and does the proving:
https://darkmarket-231379770796.europe-west1.run.app

The front end is static and deploys from this repo on every push. Everything
that proves and submits runs behind the backend URL, because a wallet sync holds
websockets open for minutes and proving needs a gigabyte of keys, and neither of
those is a serverless function.

## Deployed

Live on Midnight preprod:

```
92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

Read it yourself, no wallet needed, from the `stack-1x` branch:

```
MIDNIGHT_NETWORK_ID=preprod bun run packages/executor/src/ledger-read.ts   92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

preprod runs midnight-node 1.x, which is why that address lives on `stack-1x`.
The default branch targets node 2.x and its wallet sync cannot decode preprod's
ledger events.

## What you can check yourself

`packages/executor/src/ledger-read.ts` reads an epoch straight off the Midnight
indexer. No wallet, no funds, no signing, no proof server. Anyone can run it.

That is the point. Whatever it prints is everything an observer of the chain can
learn about an epoch, so the privacy claim is testable instead of asserted.

```
bun run packages/executor/src/ledger-read.ts <contractAddress>
```

## The trust boundary, said out loud

An EVM contract cannot verify a Midnight proof today. There is no precompile for
it.

So a closed epoch reaches Polymarket through an executor holding a funded wallet,
and that executor could in principle report an aggregate the Midnight ledger does
not support. It never sees an individual intent and it cannot forge the proof,
but it is trusted to relay honestly.

Anyone can catch it. The aggregate is on Midnight's public ledger and the fill is
on Polygon, so a lie is visible to whoever reads both. Auditable rather than
blind, which is the honest description and not a flattering one. The fix is proof
verification on the EVM side, once there is something to verify against.

## Known limits

Epoch size is fixed at five. Compact has no unbounded loops, so the opening loop
has a hard count and a bigger epoch means a bigger circuit, not a config change.

No Map ledger yet. Flat slots are what the builtin `midnightGeneric` grammar
knows how to parse, and a Map changes the payload shape.

## Running it

Everything runs in Docker. The stack is a local Midnight node, an indexer, a
proof server, two Hardhat chains, a sync node and a batcher.

```
docker build -t darkmarket .
docker run -d --name dm -p 6300:6300 -p 8088:8088 -p 9944:9944 -p 9999:9999 darkmarket

# deploy the circuit
MIDNIGHT_NETWORK_ID=undeployed bun run packages/contracts-midnight/deploy-midnight.ts
```

For preprod, put a 24-word `MIDNIGHT_WALLET_MNEMONIC` in `.env.local` and set
`MIDNIGHT_NETWORK_ID=preprod`. Note that preprod runs midnight-node 1.x, so it
needs the `stack-1x` branch. The default branch targets node 2.x and its wallet
sync will fail to decode preprod's ledger events.

The local chain runs on a one second block time and the sync process falls over
at block 65536, so a container lives about 18 hours. Restart it before you need
it to behave.

## Credit

Starts from the `evm-midnight-v2` template in
[effectstream/effectstream](https://github.com/effectstream/effectstream),
branch `v-next` at `332503c`.

That template does not build from a clean clone. Six things are broken, from a
compiler pin that was pulled from the release server to a proof-server binary
whose ELF interpreter points into a Nix store that does not exist on Debian.
All six are fixed here, kept as a patch in `patches/`, and reported upstream as
[effectstream#895](https://github.com/effectstream/effectstream/issues/895),
where a maintainer confirmed a fix is coming.

The baseline commit is third-party scaffolding and is labelled as such. Every
commit after it is this weekend's work.
