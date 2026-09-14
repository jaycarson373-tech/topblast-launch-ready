# TopBlast Launch

The StonkFun launchpad layer for funded TopBlast rewards.

Creators launch through StonkFun’s official non-custodial API. TopBlast registers the finalized LaunchLab market, replays finalized Solana blocks, tracks exact verified buy basis per launch, accepts attributable creator deposits, creates conservative reward snapshots, reserves funded budgets, prepares wallet-approved payouts, reconciles finality, and publishes proof.

## Funding model

StonkFun standard LaunchLab creator fees are forwarded to the creator wallet. The public API does not expose a per-launch fee-recipient split. TopBlast therefore uses explicit creator deposits. The fixed launch allocation is enforced in the deposit transaction: the reward and protocol amounts are transferred, while the creator portion stays in the creator wallet. A slider alone never counts as funding.

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
