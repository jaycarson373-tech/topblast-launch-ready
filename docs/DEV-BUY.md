# Optional atomic dev buy

Both venue launch forms accept an optional dev-buy amount in the selected quote
asset. Blank or zero creates the token without a buy. Changing venue or pair
clears the amount so a SOL amount is not silently reused for a different asset.

The connected creator signs one transaction containing venue creation and the
venue's official purchase instruction. Purchased tokens go directly to the
creator's token account. No purchase tokens pass through the platform treasury.
Creation and buying are atomic. Failure does not leave a successfully created
token with an unexecuted buy; network fees can still be charged for a failed
submitted transaction.

The review shows the quote-asset spending cap, minimum tokens, recipient and
estimated SOL debit. The cap includes venue trading fees. Network fees and
account rent are additional. Stonk SOL buys wrap only the chosen amount into
WSOL. Other quote assets must already be in the creator wallet. Buying does
not fund the reward pool or guarantee reward eligibility.

Amounts are exact integer atoms using verified mint decimals. Graduation-sized
initial buys are rejected. Oversized messages use validated finalized venue
address lookup tables; unavailable tables fail preparation without submission.
Both mint and creator signatures are verified against the immutable reviewed
message. Recovery resubmits only the same stored signed transaction, including
the buy, never a second standalone purchase.

## Verification, 2026-09-24

- Unsigned mainnet RPC simulations passed for Stonk and Pump creation plus a
  0.001 SOL buy. No transaction was signed or submitted, no token was created,
  and no funds were spent in these checks.
- Unit tests cover exact caps, lookup-table validation, both required
  signatures, message tampering, atomic first-buy basis and zero-basis issuance.
- These checks are not real onchain launch/purchase receipts and do not prove
  the full automatic holder reward lifecycle.

The reserved TOPBLAST creator key is unrelated to browser dev-buy signing.
Its future mint-scoped Stonk claims/payout role still requires activation and
verification. The general launchpad treasury remains unchanged.
