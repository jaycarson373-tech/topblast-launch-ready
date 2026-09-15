# Pump.fun controlled-test setup

## Available now

On `/launch`, select **Pump.fun · SOL pair** to see the actual activation blockers.
On `/test`, select **Pump.fun · SOL / WSOL rewards** for a free, explicitly simulated reward rehearsal.

The implementation uses the official `@pump-fun/pump-sdk` create_v2 instruction. It requires a browser mint signature and creator wallet signature. Mainnet identity, the global creation switch, simulated creation, a stable balance estimate, immutable metadata, and durable submission receipts are checked before the launch is accepted.

Pump.fun native holder rewards are **not** enabled. They are distributed by Pump.fun, not TopBlast. TopBlast uses explicit creator deposits, wraps the reward/protocol portions from SOL into WSOL, and uses the existing launch-isolated payout engine. Fee claims remain on Pump.fun; an aggregate creator vault is not treated as attributable launch funding.

## Required operator action

September 15 update: Railway billing now accepts deployments. However, the existing `topblast-launch` project's `web` and `rewards-worker` services have been connected to `jaycarson373-tech/topblast-robinhood`. Its automatic deployments superseded this launchpad's uploads. Confirm which application owns those services before reconnecting or redeploying. Do not overwrite Robinhood's configuration or create duplicate paid services without that choice.

The existing Supabase project is connected. `202609150001_pumpfun.sql` was applied through its signed-in SQL editor on September 15. The deployed health endpoint now reports `pumpSchemaReady=true`. Live permission checks verified metadata RLS enabled, anonymous reads denied, and service-role insert allowed but update/delete denied. No SQL copy/paste or new Supabase project is needed.

Supply these public wallet addresses for Vercel and Railway:

```text
TOPBLAST_TREASURY_ADDRESS=<public reward treasury address>
PROTOCOL_TREASURY_ADDRESS=<public protocol treasury address>
```

They may be the same wallet. The creator funding wallet must be different. No private key belongs in chat, Vercel, or Railway for the current manual-wallet signing mode.

After migration and address verification, the operator can enable controlled creation:

```text
PUMPFUN_ENABLED=true
LAUNCHES_ENABLED=true
DRY_RUN=true
PAYOUT_MODE=manual_wallet
```

`DRY_RUN=true` does **not** make launch transactions free. Enabling launches allows a real mainnet creation after wallet approval. It keeps funding/payout submission locked. Review the exact creation transaction first.

Only when ready for the approved real funding/payout test should the operator set `DRY_RUN=false` and enable epoch planning in Admin. Every payout still requires a treasury wallet signature. Pump rewards are WSOL; SOL is also needed for network fees and token-account rent. Do not fund an arbitrary large treasury balance.

## Remaining limits

- No real TopBlast Pump launch → verified funding → confirmed payout cycle has been demonstrated.
- PumpSwap graduation is not implemented. Tracking and new epochs pause when the curve graduates; do not market uninterrupted post-graduation rewards.
- Native Pump holder rewards, cashback, mayhem mode, and non-SOL pairs are not supported.
- USD market metrics are unavailable; the tracker uses finalized SOL-denominated curve prices.
- This is controlled-test support, not certification for permissionless production release.

## Verification

`pnpm verify:pump` checks the mainnet creation switch, decodes a recent existing trade, and simulates an unsigned create instruction. It never signs, sends, or creates a token.

Read-only check on September 15 decoded an existing buy at slot `447265063`, signature `5uoGbUnVUCKVJhzYXjAGTP54TbfogMJM7kHQ4THAapP81ySDPZc7QCq7NvhYwF3onoc3vk8MmTAzGN32A5YSK3ip`. Unsigned creation simulation passed at 97,358 compute units. This is not our launch or payout receipt.

Unit tests cover preparation, venue disablement, wrong-network RPC, balance changes, exact receipt recovery, expired transactions, and same-byte rebroadcast. Browser tests use a fake wallet and intercepted APIs to exercise the mint partial-signature and refresh recovery with one signing prompt and one submission. Neither test is an onchain acceptance cycle.
