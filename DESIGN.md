# THRESHOLD

A gate you get through without showing why.

The idea is small. Somebody needs to prove they qualify for something. A loan, a rental,
a whitelist, a payout tier. The thing checking them does not need the underlying numbers.
It needs a yes. Today it takes the numbers anyway, because that is the only way anyone
knows how to build it.

So: the sensitive facts go into a Compact circuit on Midnight. The circuit runs the policy
and discloses one verdict. An EVM chain acts on the verdict. The EVM side never sees an
income figure, never sees a bank balance, never sees a repayment history. It sees a tier
and an expiry date.

## Why this is a cross-chain build and not a Midnight build

The template we start from says it better than we could:

> The join happens in the rollup, not on a bridge.

There is no relayer here. No light client, no message-passing contract, no wrapped token.
The two chains do not know about each other. They share one key, and an EffectStream sync
node reads both and merges them into one table. That is the whole trick, and it is the
reason this design is cheap enough to build in a weekend.

Midnight is the privacy engine. EVM is where the consequence lands. EffectStream is the
thing in the middle that keeps a consistent view of both.

## The three pieces

The Compact circuit takes private inputs and writes a verdict to Midnight's public ledger.
Whatever it writes through `disclose` is exactly what the outside world gets to see, so
designing the circuit is the same job as designing the sync surface. Get greedy with
`disclose` and you have leaked the thing you were protecting.

The state machine picks up that verdict off the Midnight ledger, keyed by subject, and
folds it into Postgres alongside whatever the EVM side has been doing. Attestations
accumulate here. The ledger holds the latest one, the rollup holds the history.

The EVM contract holds the gate. It reads a tier from a registry and lets an action
through or does not.

## The trust boundary, said out loud

Here is the honest part, and we are putting it in the README too.

An EVM contract cannot verify a Midnight proof today. There is no precompile for it.
So the verdict reaches EVM through an authorised submitter, which is the batcher's own
funded wallet. That means the EVM gate trusts the rollup. It does not trust the user,
and it never sees the private data, but it does trust that the submitter is reporting
what the Midnight ledger actually says.

That is a real assumption and pretending otherwise would be worse than having it. Anyone
can check the submitter's claim by reading the Midnight ledger themselves, so the trust
is auditable rather than blind. The upgrade path is proof verification on the EVM side
once Midnight ships something to verify against.

## What we are deliberately not doing

Not building a Map ledger in v1. The template uses flat ledger slots and the builtin
`midnightGeneric` grammar knows how to parse those. A Map changes the payload shape and
the grammar might not follow it. That is a fine thing to try on Sunday morning with a
working demo already in the bag. It is a terrible thing to try on Friday night.

Not building a bridge. See above.

Not reusing VIGIL, TENANT, or anything else. Everything in this repo past the baseline
commit is written this weekend.

## Provenance

Baseline is `effectstream/effectstream` branch `v-next` at `332503c`, template
`templates/evm-midnight-v2`. It arrives with six things broken from a clean clone. Those
are fixed here and reported upstream as effectstream/effectstream#895, where a maintainer
confirmed a fix is coming. `patches/` holds them as a standalone patch.

The baseline commit is tagged as third-party scaffolding. `git log` after it is ours.
