# DARKMARKET

A dark pool for prediction markets. Positions match privately on Midnight, and
only what nobody here will take the other side of reaches the open market.

Built for the MLH Midnight hackathon, 28-30 August 2026, cross-chain track.

## The problem

Put real size into a Polymarket book and it sits there in public. Your side,
your size, roughly your conviction, readable before you are filled. People trade
against that, and the bigger your order the worse it gets.

Equities solved this decades ago with dark pools: orders match away from the
public book, and only what fails to match goes out where everyone can see it.
Prediction markets never got one.

## How it works

**Open.** A wallet opens a position. What lands on Midnight is a commitment,
32 bytes that reveal neither side nor size, sitting there publicly and
timestamped by its block. Anyone can see a position exists. Nobody can see what
it is.

**Match.** Another wallet takes the other side. Both openings are proved against
commitments sealed earlier, in a single proof that checks the sides are actually
opposite. What reaches the chain is one total. Neither size is recoverable from
it, and no observer learns which commitments were consumed. Nothing reaches the
open market at all.

**Or cover.** Nobody wants the other side, so liquidity on Polygon takes it
instead. Collateral in a vault contract funds the fill, and the settlement
records the Midnight contract, the conditionId and the amount, so the two chains
can be lined up and checked against each other.

## Why this is cross-chain and not a Midnight app with an API call

There is a Compact contract on Midnight and a Solidity contract on Polygon, and
both see real transactions. Neither chain knows the other exists. They are
correlated by a shared key, Polymarket's `conditionId`, which is the same 32
bytes its own conditional-token contract uses.

A settlement on Polygon names the Midnight contract and epoch it came from.
Read one, read the other, check they agree.

## The part that took longest to get right

You cannot hide a size by adding it to a public total one transaction at a time.
The delta between two blocks is the size. No cryptography fixes that, and
Compact's compiler stops you: adding a secret to a public field is exactly what
`disclose` exists to make you admit.

So sizes only ever reach the ledger inside a proof that combines at least two of
them. And `disclose()` is an acknowledgement to the compiler, not an emission:
nothing is broadcast when you call it. What reaches the chain is the ledger state
after the transaction, and that state holds totals.

## Live

Front end: https://darkmarket-midnight.vercel.app

Nothing to install. The page talks to a backend that runs its own Midnight node,
indexer and proof server, compiles and deploys the circuit when it boots, then
brings up five wallets. Cold start to five wallets ready is about two minutes.

The Midnight contract id is on the trade page rather than in here, because it
changes every time that container restarts. The chain restarts with it.

Polygon vault (Amoy): [0x4b6d7c58250F5B1c38f3ba22F8cC03Fdc4f1125B](https://amoy.polygonscan.com/address/0x4b6d7c58250F5B1c38f3ba22F8cC03Fdc4f1125B)

Midnight contract on preprod:

```
92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

Read it yourself, no wallet needed, from the `stack-1x` branch:

```
MIDNIGHT_NETWORK_ID=preprod bun run packages/executor/src/ledger-read.ts \
  92a6d8c2f709b5df7c9e1c7370419d22e1dbabb764ca150ba754a14f38294d92
```

## What is real and what is not

Worth saying plainly rather than leaving a judge to find it.

The circuits, the proofs and the five wallets are real. Each wallet has its own
key, its own database, its own balance, and signs its own transactions.

The Polygon side is real. The vault is deployed, holds deposits and has settled
transactions you can open on Polygonscan.

**Trading runs on a Midnight chain we start, not on preprod.** The chain is real
and so are the proofs on it, but it belongs to the container and it dies with the
container. Preprod does not work for us. Its faucet rejects addresses that
Midnight's own codec validates, and the wallet we did fund generates no dust, so
it cannot pay a fee. That is measured rather than assumed: the indexer reports
zero dust generation items for the address. The preprod contract above is real
and readable and proves the circuit deploys to a public Midnight network. The
trading happens on ours.

**Polymarket's orderbook is mainnet-only.** Its CTF Exchange is deployed on Amoy
at `0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40`, so the contracts exist on
testnet, but there is no counterparty book there. Prices and market identity come
from the live Polymarket API; the fill rests in our vault.

## The trust boundary

An EVM contract cannot verify a Midnight proof today. There is no precompile.

So a cover reaches Polygon through an executor holding a funded wallet, and that
executor could report an amount the Midnight ledger does not support. It never
sees an individual position and it cannot forge the proof, but it is trusted to
relay honestly.

Anyone can catch it, because both sides are public and carry the same
identifiers. Auditable rather than blind, which is the honest description and
not a flattering one. The fix is proof verification on the EVM side, once there
is something to verify against.

## Running it

You do not have to. The link above is the same container, already running. This is
for reading the thing yourself.

One image holds the lot: a Midnight node, an indexer, a proof server and the
interface. The Polygon side is not local, it points at Amoy.

```
docker build -t darkmarket .
docker run -d --name dm -p 4000:8080 darkmarket
```

The container starts its chain, deploys the circuit, and boots five wallets. A
cold start pulls down about a gigabyte of proving keys, so give it a minute. The
page comes up straight away and tells you where it has got to while it works.

## Credit

Starts from the `evm-midnight-v2` template in
[effectstream/effectstream](https://github.com/effectstream/effectstream),
branch `v-next` at `332503c`.

That template does not build from a clean clone. Six things are broken, from a
compiler pin that was pulled from the release server to a proof-server binary
whose ELF interpreter points into a Nix store that does not exist on Debian. All
six are fixed here, kept as a patch in `patches/`, and reported upstream as
[effectstream#895](https://github.com/effectstream/effectstream/issues/895),
where a maintainer confirmed a fix was coming.

The first commit is that template, labelled as such. Everything after it is this
weekend's work.
