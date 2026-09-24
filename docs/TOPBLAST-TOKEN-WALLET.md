# TOPBLAST creator wallet and the existing treasury

Railway project: `topblast-stonkfun-launchpad`.
Environment: `production`. Service: `rewards-worker`.

There is one payout treasury. Keep `TREASURY_PRIVATE_KEY` and
`TOPBLAST_TREASURY_ADDRESS` unchanged. The existing treasury continues handling
the launchpad's funded rewards and also derives its Stonk fee receiver wallets.

The additional wallet is TOPBLAST's creator wallet, not another reward treasury.
Reserved creator variables:

| Variable | Value |
| --- | --- |
| `TOPBLAST_CREATOR_PRIVATE_KEY` | TOPBLAST creator wallet secret, entered directly in Railway only |
| `TOPBLAST_CREATOR_ADDRESS` | Matching creator public wallet address |
| `TOPBLAST_TOKEN_MINT` | Verified TOPBLAST token contract address |

These are reserved configuration fields. The current worker does not consume
the creator key. The requested role is to handle only TOPBLAST's own Stonk
creator fees and holder airdrops, scoped to its verified mint. This separate
creator-operation path is not yet activated. All other launches keep their
existing treasury path. A redeploy alone does not enable this role.

Never place the secret in chat, Git, Supabase, Vercel, browser storage, or a
`NEXT_PUBLIC_` variable. Use Railway's sealed-variable setting for the secret.
Only the public wallet address and mint are needed in chat.

Before consuming the creator key, bind it to the verified TOPBLAST creator
address and mint, verify its Stonk fee entitlement and attributable funding,
scope every claim and payout to that launch, and review exact transactions
before authorizing them. The launch UI uses the connected creator wallet's
approval; a server-side key does not replace that approval.
Do not reassign existing funding balances, fee receivers or prepared payouts.

The creator wallet does not automatically inherit venue fee rights. Verify any
creator fee setup against the actual venue and launch. Keep launch accounting
and onchain receipts intact. The full funded payout and restart cycle still
requires verification.
