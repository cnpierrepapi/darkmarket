# Faucet these five addresses

https://faucet.preprod.midnight.network/
(mirror: https://midnight-tmnight-preprod.nethermind.dev/)

Turnstile-gated, so it has to be a human. One address at a time.

Use the **shielded** address below. The faucet rejects the `mn_addr_` unshielded
form with "Provided address is invalid": it drips to `mn_shield-addr_`.

## Participant 0 — this one too, it has run out of dust

mn_shield-addr_preprod10g9c0mx4qszp9fgumnyye2dvmkzeqvzeaaljzertkj68v3u0aa87su9hha5ym3u7dllfwps7gcnzmhe7ez763nuxzjlz2r6fv0ltf9c76hfqf

## Participant 1

mn_shield-addr_preprod1j95fc29rpajxt28zhckvjzrvxj36r3ky8uzcpzlaueey0lcxnxcd4jezw4x8jf5w7pmdygac440jm6urjgmec6l073jfcvjlf2pn79q2hfnsw

## Participant 2

mn_shield-addr_preprod19lnszst2v75f5dlr6zgcj829rufzgs5ta3z6lu6w0pyn342xfqs5j3a2k94z8rv5slc8d4f0ds2jcju6fxtmvrvqxvy620v8twkcewq45k46u

## Participant 3

mn_shield-addr_preprod16rsemremu9743d5mjt23wn4s4f9fgpfyx5azncnfws75a80y7gkk8m4stumlt8upyswtk8u3ytcrjwccjy4txf38pmts2q84me76e8qg7fq7z

## Participant 4

mn_shield-addr_preprod1yrzd5wkvcqsvheldhx2rt6xk29u4fpu7gkezzuh78ezewxrwcajg99mp8kctzjavvzuu8qw6x9apsmwygy0q8cmrhrakwnhd3pj8duggz7k66

## The three address forms, so this does not happen again

Every participant has three, and they are not interchangeable:

- `mn_shield-addr_` — shielded. **This is the one the faucet takes.**
- `mn_addr_` — unshielded, holds NIGHT, what a transfer sends to.
- `mn_dust_` — dust, where fee-paying dust accrues.

## Why fauceting each one beats transferring between them

Faucet output arrives already registered for dust generation. Transferred NIGHT
may not, and registering is itself a transaction costing dust, which a fresh
wallet does not have. Fauceting each participant walks around that circle
rather than trying to break it.
