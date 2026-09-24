# TOPBLAST creator wallet and the existing treasury

Railway project: `topblast-stonkfun-launchpad`.
Environment: `production`. Service: `rewards-worker`.

Keep the platform treasury's `TREASURY_PRIVATE_KEY` and
`TOPBLAST_TREASURY_ADDRESS` unchanged. The existing treasury continues handling
the launchpad's funded rewards and also derives its Stonk fee receiver wallets.

The additional wallet is TOPBLAST's creator wallet, not another reward treasury.
Creator variables:

| Variable | Value |
| --- | --- |
| `TOPBLAST_CREATOR_PRIVATE_KEY` | TOPBLAST creator wallet secret, entered directly in Railway only |
| `TOPBLAST_CREATOR_ADDRESS` | Matching creator public wallet address |
| `TOPBLAST_TOKEN_MINT` | Verified TOPBLAST token contract address |

The payout worker can select this creator key only for TOPBLAST's exact Stonk
mint, matching creator and verified active market, with an immutable funding
configuration that names this wallet. It cannot sign another launch's payouts.
All existing launches retain their original treasury. Missing or mismatched
configuration stops signing; there is no fallback to the platform wallet.

Setting `TOPBLAST_TOKEN_MINT` starts an idempotent external Stonk registration
check. It verifies the official token listing, actual creation instruction,
mint, pool, creator, quote asset and mint decimals. Only a matching finalized
creation receipt and a registered tracker can publish the token. No fake launch
submission or payment receipt is created, and the worker never launches a second
token on retry. For unusually long market histories, the optional
`TOPBLAST_LAUNCH_SIGNATURE` supplies the exact creation receipt.

For this dedicated wallet, the funding reader verifies that it owns exactly one
LaunchLab pool. It uses the official Stonk fee response's transaction signature
to identify the forwarding source, then verifies exact SPL transfers, mint,
decimals, source authority, recipient and both account balance deltas. Receipts
must be finalized and inside indexed history; duplicates are consumed once by
the existing atomic funding function. Credited totals cannot exceed Stonk's
reported forwarded total. Donations, gas SOL and projected fees are not credits.
Multiple pools, unsupported token programs, ambiguous transfers or unavailable
history stop new funding rather than guess. Never reuse this creator wallet for
another token.

Verified funds use the existing immutable 90% holder / 0% creator / 10% protocol
allocation and existing epoch, loss weighting, reservation and durable payout
pipeline. Holder transfers are signed only by this mint's creator key. A protocol
ledger credit is not evidence of an executed buyback or burn.

Implementation and fixture tests do not prove live TOPBLAST payouts. Its complete
real funded holder-payout and restart cycle still requires acceptance after the
mint exists. Do not announce full readiness until that cycle is demonstrated.

Never place the secret in chat, Git, Supabase, Vercel, browser storage, or a
`NEXT_PUBLIC_` variable. Use Railway's sealed-variable setting for the secret.
Only the public wallet address and mint are needed in chat.

Before activation, bind it to the verified TOPBLAST creator
address and mint, verify its Stonk fee entitlement and attributable funding,
scope every claim and payout to that launch, and review exact transactions
before authorizing them. The launch UI uses the connected creator wallet's
approval; a server-side key does not replace that approval.
Do not reassign existing funding balances, fee receivers or prepared payouts.

The creator wallet does not automatically inherit venue fee rights. Verify any
creator fee setup against the actual venue and launch. Keep launch accounting
and onchain receipts intact. The full funded payout and restart cycle still
requires verification.

## Explore and launch origin

`EXPLORE_FEATURED_MINTS=TOP_CA,TOPBLAST_CA` on the web deployment selects the
editorial order under Featured. It never creates a launch, revives a hidden
listing, or changes the New/Volume sorting. Use exact CAs, never token names.
TOPBLAST created by a bundle service is a Stonk launch registered with TopBlast
rewards, not a launch transaction submitted by the TopBlast website. Do not
fabricate a platform submission receipt.
After verified registration, the worker publishes only the public mint to
`system_config.topblast_registered_mint`. The web app reads that for the header
CA and appends it after the configured TOP Featured placement. Creator secrets
remain exclusively on Railway; this publication needs no Vercel secret.

## Current TOP acceptance check, September 24

TOP mint: `85iZwkRNwUs8q9sfLJCXhiVsny4faMyf5nbDQZ7x6omB`.
Creator: `Ea5JBhYw2boPokBs5uxaB5YkY1AsAkhPff6nFVCRA3AZ`.
Its dedicated receiver is `2A3RvpbHkcgL5XTkqdxYXb6Ywp1pXRSodF8W6bx7GST9`.
It remains on the existing platform treasury, with 90% rewards / 0% creator /
10% protocol and a 65% epoch release. At 16:27 UTC its one-time receiver gas
operation was blocked by insufficient *unencumbered* platform SOL, history was
still catching up, and no funding or holder payout had been recorded.
These are observations, not permanent statuses; recheck before activation.

After the owner added operating SOL, the worker confirmed receiver gas funding:
`5ALLXadoSpQFNqC8QaERo8itVt7iXv8ZV6EMQyrimgxnwH193EAsG9YQMokSv262Cv8zygDSaJRA1MyEd4dNrKKm`.
This is a 0.01 SOL operating transfer, **not a holder reward**. Stonk's official
creator-fee diagnostic then reported zero accrued / forwarded fees and a $5
forwarding threshold. No holder distribution was recorded at that check.

## Reuse and evidence

The single-token worker's `stonk-launchlab-funding.mjs` supplied the exact-route,
authority and account-delta verification pattern. The multi-token system retains
its existing entry, eligibility, epoch, allocation and payout modules. The old
worker's unrelated funding-tranche economics were not copied.

Archived public receipt `ahQxnD37aUc4rfRmUTdgebkHKdrjv87ySJ1CWuKu4EVLBHeLWzdEijs1xjU1XZ99Vrs3EzjvrAAEtQegKruUj1G`
at slot 450084897 verifies an actual 101790550-atom WSOL Stonk forward to a
third-party creator. It is read-only format evidence, **not a TOP or TOPBLAST
payout**. The exact public receipt and TOP creation transaction are test fixtures.
