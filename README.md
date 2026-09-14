# TopBlast Launchpad MVP

Launch through StonkFun, then track verified buyers and run isolated, funded TopBlast reward epochs.

## Current source audit

The provided workspace and adjacent workspace were empty, and the connected GitHub installation exposed no TopBlast repository. No existing TopBlast production code could be audited or reused. The engine in this MVP therefore implements the mechanics stated in the brief, but it must be compared with the real TopBlast engine before production payouts.

## StonkFun integration

The adapter uses the official public API at `https://www.stonkfun.xyz/api/public/v1`:

- `GET /pairs?launchable=true&launchLabReady=true`
- `POST /launches/prepare`
- creator wallet signs the returned payment transaction locally
- `POST /launches/submit`
- `GET /launches/{paymentSignature}` while processing
- fee read and claim prepare/submit methods

StonkFun LaunchLab currently forwards the standard creator share to the creator wallet. The API does not expose a fee-recipient split or delegation field. Therefore TopBlast cannot automatically take the configured share from a user-owned creator wallet. Rewards only use confirmed `fee_events` attributed to the same `launch_id`; funding that event is a manual creator deposit until StonkFun adds routing/delegation or a reviewed custody design is approved.

## Local setup

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Apply `supabase/migrations/202609130001_topblast_multilaunch.sql`, configure a Helius enhanced-transaction webhook to `/api/indexer/helius` with `Authorization: Bearer $HELIUS_WEBHOOK_SECRET`, and leave both `DRY_RUN=true` and `reward_engine_paused=true` until snapshot proofs are reviewed.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
