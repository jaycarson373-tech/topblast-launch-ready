> Audit update, September 14: this runbook describes infrastructure setup, not a completed reward system. The current worker does not schedule/persist epochs or execute/reconcile payouts, and fee deposits are not connected. Do not advertise live rewards after merely adding environment variables. Apply both SQL migrations in order. `pnpm verify:production` now fails until launches AND rewards are ready; use `pnpm verify:production -- --smoke` for availability-only checks.

# TopBlast Launch: exact go-live runbook

Production web URL: `https://topblast-stonkfun-launchpad.vercel.app`

Railway project: `topblast-launch`

Railway services already created:

- `web`
- `rewards-worker`

Keep `LAUNCHES_ENABLED=false`, `DRY_RUN=true`, and `reward_engine_paused=true` until every check below passes.

## 1. Create Supabase and paste the schema

1. Create a Supabase project in a North American region.
2. Open **SQL Editor**, choose **New query**, and run these files once, in order:
   - `supabase/migrations/202609130001_topblast_multilaunch.sql`
   - `supabase/migrations/202609140001_audit_hardening.sql`
   - `supabase/migrations/202609140002_operational_pipeline.sql`
3. Confirm `launch_submission_receipts`, `chain_event_inbox`, `funding_intents`, `launch_funding_balances`, `price_observations`, `worker_leases`, and `payout_batches` exist.
4. Open **Project Settings > API**.
5. Copy the project URL and the `service_role` key. The service-role key is server-only.

Do not run the migration a second time against a partially-created schema.

## 2. Wallet setup

Use separate wallets:

1. **Creator wallet**: browser wallet that signs the StonkFun launch payment. Fund this only with the SOL needed for the launch payment and fees.
2. **TopBlast reward treasury**: public address stored as `TOPBLAST_TREASURY_ADDRESS`. It holds funded STONK rewards and a small amount of SOL for transaction fees.
3. **Protocol treasury**: public address stored as `PROTOCOL_TREASURY_ADDRESS`.

Do not paste a seed phrase, private key, or keypair JSON into Vercel, Railway, this repository, chat, or any `NEXT_PUBLIC_*` variable. The MVP uses `PAYOUT_MODE=manual_wallet`: Railway prepares and hashes the payout manifest, then an operator approves the exact transaction with a browser wallet.

Do not put 10 SOL in the reward treasury just for transaction fees. Start with a small operational amount after verifying the address. Keep the actual reward budget in STONK. The creator wallet separately needs whatever amount the signed StonkFun quote displays.

## 3. Create the Helius webhook

Create one **Enhanced Mainnet** webhook with:

```text
URL=https://topblast-stonkfun-launchpad.vercel.app/api/indexer/helius
Transaction types=ANY
Initial monitored address=YOUR_TOPBLAST_TREASURY_ADDRESS
Authorization header=Bearer YOUR_HELIUS_WEBHOOK_SECRET
```

Copy the resulting webhook ID. After each successful StonkFun launch, TopBlast automatically adds that mint and pool address to this webhook. If Helius cannot be updated, the market remains inactive and the admin panel records the tracker error.

## 4. Paste these variables into Vercel

Open **Vercel > topblast-stonkfun-launchpad > Settings > Environment Variables** and paste into Production:

```text
NEXT_PUBLIC_APP_URL=https://topblast-stonkfun-launchpad.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
HELIUS_API_KEY=YOUR_HELIUS_KEY
HELIUS_WEBHOOK_ID=YOUR_HELIUS_WEBHOOK_ID
HELIUS_WEBHOOK_SECRET=YOUR_LONG_RANDOM_WEBHOOK_SECRET
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
TOPBLAST_TREASURY_ADDRESS=YOUR_REWARD_TREASURY_PUBLIC_ADDRESS
PROTOCOL_TREASURY_ADDRESS=YOUR_PROTOCOL_TREASURY_PUBLIC_ADDRESS
ADMIN_API_TOKEN=YOUR_DIFFERENT_LONG_RANDOM_ADMIN_SECRET
STONKFUN_API_URL=https://www.stonkfun.xyz/api/public/v1
STONK_QUOTE_MINT=6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx
NEXT_PUBLIC_STONK_QUOTE_MINT=6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx
TOPBLAST_MIN_REWARD_PERCENT=50
REWARD_EPOCH_SECONDS=3600
PAYOUT_MODE=manual_wallet
DRY_RUN=true
LAUNCHES_ENABLED=false
```

Redeploy after saving.

## 5. Paste these variables into both Railway services

Open the Railway `topblast-launch` project. For both `web` and `rewards-worker`, use **Variables > RAW Editor** and paste:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
HELIUS_API_KEY=YOUR_HELIUS_KEY
HELIUS_WEBHOOK_ID=YOUR_HELIUS_WEBHOOK_ID
HELIUS_WEBHOOK_SECRET=YOUR_LONG_RANDOM_WEBHOOK_SECRET
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
TOPBLAST_TREASURY_ADDRESS=YOUR_REWARD_TREASURY_PUBLIC_ADDRESS
PROTOCOL_TREASURY_ADDRESS=YOUR_PROTOCOL_TREASURY_PUBLIC_ADDRESS
ADMIN_API_TOKEN=YOUR_DIFFERENT_LONG_RANDOM_ADMIN_SECRET
STONKFUN_API_URL=https://www.stonkfun.xyz/api/public/v1
STONK_QUOTE_MINT=6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx
TOPBLAST_MIN_REWARD_PERCENT=50
REWARD_EPOCH_SECONDS=3600
REWARD_WORKER_POLL_SECONDS=30
INDEX_BLOCK_BATCH_SIZE=100
MAX_PRICE_AGE_SECONDS=180
MAX_PRICE_GAP_SECONDS=180
PAYOUT_BATCH_SIZE=4
PAYOUT_MODE=manual_wallet
DRY_RUN=true
LAUNCHES_ENABLED=false
```

Service-specific variables are already configured:

```text
web: SERVICE_MODE=web
rewards-worker: SERVICE_MODE=worker
```

Seal `SUPABASE_SERVICE_ROLE_KEY`, `HELIUS_API_KEY`, `HELIUS_WEBHOOK_SECRET`, and `ADMIN_API_TOKEN` in Railway after saving them.

## 6. Verify before enabling launches

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npx vercel --prod --yes
pnpm verify:production
```

Confirm:

```text
GET https://topblast-stonkfun-launchpad.vercel.app/api/live -> HTTP 200
GET https://topblast-stonkfun-launchpad.vercel.app/api/health -> HTTP 503 while LAUNCHES_ENABLED=false
```

Open `/admin`, enter `ADMIN_API_TOKEN`, and confirm the exact treasury public address and its RPC balance. Do a tiny test transfer before funding it further.

## 7. Activate controlled launches

Change `LAUNCHES_ENABLED=true` in Vercel and Railway web, then redeploy. `/api/health` must return HTTP 200 with `"ready": true`.

Leave these unchanged:

```text
DRY_RUN=true
PAYOUT_MODE=manual_wallet
```

Run one controlled launch. Verify its mint, pool, launch transaction, active tracked market, Helius delivery, and one recognized buy before opening the site publicly.

## 8. Reward worker and payouts

The Railway worker runs continuously, writes a heartbeat to `system_config`, replays finalized blocks from each launch slot, validates LaunchLab swap accounts and exact SPL movements, records conservative prices, reconciles deposits and payouts, survives restarts, and isolates every query by `launch_id`. It continues indexing while `reward_engine_paused=true`, but creates no new epochs.

After reviewing a dry-run epoch, use `/admin` to prepare the exact payout transaction. Verify its epoch, launch, reward mint, treasury, recipients, total, and SHA-256 manifest hash before approving it with the treasury browser wallet. Signed bytes are persisted before broadcast and finalized bytes are reconciled before any row becomes paid.

For the controlled real-money acceptance only, set `DRY_RUN=false` after reviewing the addresses and tiny amounts. Explicit creator funding and each payout still require a browser-wallet signature. The application has no private-key environment variable and does not perform unattended signing.

Run the acceptance cycle with deliberately tiny amounts:

```text
launch -> finalized market registration -> verified buy -> creator deposit -> finalized price coverage -> epoch allocation -> treasury-wallet payout -> finalized public proof -> worker restart -> no duplicate
```

Do not present production rewards as proven until the completed payout signature is visible on `/token/[mint]/proof` and remains singular after restarting the Railway worker.
