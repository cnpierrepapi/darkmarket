# DARKMARKET

A dark pool for prediction markets. You take a position on Polymarket without
the market watching you take it.

Big trades have a tell. Put real size into a Polymarket book and the order sits
there in public, and anyone can read your side, your size and roughly your
conviction before you are filled. People trade against that. It is the oldest
problem in markets and equities solved it decades ago with dark pools, where
orders match away from the public book and only what fails to match gets sent out.

Prediction markets never got that. DARKMARKET is that, with the matching done in
zero knowledge on Midnight and the residual sent to Polymarket on Polygon.

## The bit that took the longest to get right

You cannot hide a size by adding it to a public total one transaction at a time.
The delta between two blocks is the size. No amount of cryptography fixes it,
and Compact's compiler will actually stop you: adding a secret to a public field
is the exact thing `disclose` exists to make you admit out loud.

Privacy only appears once several people's intents are combined before anything
is published. So DARKMARKET works in epochs.

During an epoch you seal an intent. What lands on Midnight's ledger is a
commitment, which is noise. Nobody learns your side, your size, or whether you
changed your mind.

Closing the epoch opens five intents at once, in a single call. The circuit
proves each opening matches something that was sealed earlier, adds them up, and
writes two numbers: total YES and total NO. That is all that survives.

The reason the individual sizes do not leak here is worth stating plainly,
because it looks wrong at first glance. `disclose()` is an acknowledgement to the
compiler, not an emission. Nothing is broadcast when you call it. What reaches
the chain is the final state of the ledger after the transaction, and the final
state holds two totals. The five numbers that produced them are gone.

## Crossing

Once an epoch closes with a YES total and a NO total, those two cancel each other
before anything leaves.

Say the epoch has 800 of YES and 300 of NO. The 300 crosses internally, both
sides get their position, and Polymarket sees a single order for 500. Not eight
orders. Not eleven. One, for the difference.

An epoch that happens to balance sends nothing at all. Everyone gets filled
against each other and the public tape never records that anything happened.
That is the best case, and it costs the least, which is a rare combination.

`shieldedFraction` puts a number on how much of an epoch never became public.
It is the number that makes the argument.

## The floor is in the circuit

Five sealed intents minimum. Not a config value, not a check in the API layer,
an `assert` inside `close_epoch`. An under-filled epoch does not produce a bad
proof or a warning. It fails to prove at all, so there is no transaction to send.

Hiding in a crowd requires a crowd. Enforcing that anywhere other than the circuit
would mean asking people to trust that we did.

## Where each chain sits

Midnight is the privacy engine. It holds sealed intents and does the matching.

Polygon is where the consequence lands, because that is where Polymarket lives
and where a conditional token is real.

EffectStream is in between. It reads both chains and merges them into one table.
There is no bridge here, no relayer, no light client, and neither chain knows the
other exists. They share a key and the rollup does the join. That is the template's
own idea and it is the reason this is buildable in a weekend.

## The trust boundary, said out loud

An EVM contract cannot verify a Midnight proof today. No precompile for it.

So the closed epoch reaches Polymarket through an executor holding a funded
wallet, and that executor could in principle report an aggregate that the Midnight
ledger does not support. It never sees an individual intent, and it cannot forge
the ZK proof, but it is trusted to relay honestly.

Anyone can check it. The aggregate is on Midnight's public ledger and the fill is
on Polygon, so a lie is visible to anybody who reads both. That makes it auditable
rather than blind, which is the honest description and not a great one. The fix is
proof verification on the EVM side, once there is something there to verify against.

## What v1 leaves alone

No Map ledger. The template uses flat slots and the builtin `midnightGeneric`
grammar knows how to read those. A Map changes the payload shape and the grammar
may not follow. Good thing to try on Sunday with a working demo already recorded.
Bad thing to try on Friday night.

Epoch size is fixed at five because Compact has no unbounded loops. Every circuit
compiles to a fixed shape, so the opening loop has a hard count. Larger epochs
mean a larger circuit, not a config change.

## Provenance

Starts from `effectstream/effectstream` branch `v-next` at `332503c`, template
`templates/evm-midnight-v2`. It does not build from a clean clone. Six separate
things are broken, from a pulled compiler pin to a proof-server binary whose ELF
interpreter points into a Nix store that does not exist on Debian. All six are
fixed here, kept in `patches/`, and reported upstream as
effectstream/effectstream#895, where a maintainer confirmed a fix is on the way.

The baseline commit is third-party scaffolding and is labelled as such. Everything
after it is this weekend's.
