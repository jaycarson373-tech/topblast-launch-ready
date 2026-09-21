# TopBlast Launch

The StonkFun launchpad layer for funded TopBlast rewards.

Creators launch through StonkFun’s official direct LaunchLab integration: live pricing, its standard platform, and its onchain launch rules. The retired fee-payment creation API is used only to recover old receipts. New creation uses the official Raydium SDK, a browser-held mint signer, and creator-wallet approval. TopBlast registers the finalized market, tracks verified buy basis per launch, accepts attributable deposits, reserves funded budgets, prepares wallet-approved payouts, and reconciles finality. Real end-to-end reward acceptance is still required before public activation.

## Funding model

Stonk documents creator-fee forwarding for adopted standard launches, but TopBlast does not treat that promise as collected funds. The public API does not expose a per-launch fee-recipient split. TopBlast uses explicit creator deposits. The fixed allocation is enforced in the deposit transaction: the reward and protocol amounts are transferred, while the creator portion stays in the creator wallet. A slider alone never counts as funding. Venue fees are read from the current onchain configuration, not the old selectable fee tiers.

## Reused TopBlast behavior

- Exact integer weighted-average entry and proportional basis removal
- Incoming transfers receive zero purchase basis
- Sells and outgoing transfers exclude the wallet for the epoch
- Conservative finalized price coverage using the higher of TWAP or spot
- Loss-weighted deterministic allocation bounded by funded budget
- Durable leases, cursors, idempotency keys, saved signed wire bytes, and finalized reconciliation

The prior single-token implementation was used as the behavioral source. Configuration and every financial row are now scoped by `launch_id`.

## Local verification

```bash
cp .env.example .env.local
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Apply all migrations in filename order. Keep `DRY_RUN=true`, `LAUNCHES_ENABLED=false`, and `reward_engine_paused=true` until infrastructure is configured and the controlled onchain acceptance cycle is approved.

See `DEPLOY_NOW.md` for the exact Vercel, Railway, Helius, Supabase, wallet, and activation runbook.
