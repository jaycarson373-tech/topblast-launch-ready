> Release status, September 14: the operational launch, funding, indexing, epoch, payout, reconciliation, and proof pipeline is implemented and deployed. Production rewards remain intentionally disabled until the three SQL migrations and required server-side environment variables are installed and the controlled real-money acceptance cycle is completed. `pnpm verify:production` enforces that distinction; use `pnpm verify:production -- --smoke` only for availability checks.

Current infrastructure update: the Helius API/RPC connection, production webhook, webhook secret, admin token, Vercel project, both Railway services, and the production Supabase schema are configured. The generated operational secrets are sealed in the hosting providers and stored in the macOS Keychain under account `topblast-production`. Do not recreate or paste them. The only infrastructure inputs still required are the reward and protocol treasury **public addresses**.

# TopBlast Launch: exact go-live runbook

Production web URL: `https://topblast-stonkfun-launchpad.vercel.app`

Railway project: `topblast-launch`

Railway services already created:

- `web`
- `rewards-worker`

Keep `LAUNCHES_ENABLED=false`, `DRY_RUN=true`, and `reward_engine_paused=true` until every check below passes.

## 1. Supabase is complete

The three production migrations have been applied to the existing `Topblast` Supabase project. Vercel and both Railway services already have the URL and sealed service-role credential. Do not rerun the migrations or replace these variables.

## 2. Wallet setup

Use separate wallets:

1. **Creator wallet**: browser wallet that signs the StonkFun launch payment. Fund this only with the SOL needed for the launch payment and fees.
2. **TopBlast reward treasury**: public address stored as `TOPBLAST_TREASURY_ADDRESS`. It holds funded STONK rewards and a small amount of SOL for transaction fees.
3. **Protocol treasury**: public address stored as `PROTOCOL_TREASURY_ADDRESS`.

Do not paste a seed phrase, private key, or keypair JSON into Vercel, Railway, this repository, chat, or any `NEXT_PUBLIC_*` variable. The MVP uses `PAYOUT_MODE=manual_wallet`: Railway prepares and hashes the payout manifest, then an operator approves the exact transaction with a browser wallet.

Do not put 10 SOL in the reward treasury just for transaction fees. Start with a small operational amount after verifying the address. Keep the actual reward budget in STONK. The creator wallet separately needs whatever amount the signed StonkFun quote displays.

## 3. Helius webhook is already configured

The Enhanced Mainnet webhook is active with ID:

```text
4d2a1cb0-b83c-4a90-871f-38770d19307b
```

It uses the production endpoint, `ANY` enhanced transactions, a sealed bearer secret, and an inert bootstrap address. After each successful StonkFun launch, TopBlast automatically adds that mint and pool address. Add the reward treasury public address after it is chosen. Do not create a second webhook unless this one is deliberately retired.

## 4. Paste these variables into Vercel

Open **Vercel > topblast-stonkfun-launchpad > Settings > Environment Variables** and paste into Production:

```text
NEXT_PUBLIC_APP_URL=https://topblast-stonkfun-launchpad.vercel.app
TOPBLAST_TREASURY_ADDRESS=YOUR_REWARD_TREASURY_PUBLIC_ADDRESS
PROTOCOL_TREASURY_ADDRESS=YOUR_PROTOCOL_TREASURY_PUBLIC_ADDRESS
```

Redeploy after saving.

`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HELIUS_API_KEY`, `HELIUS_WEBHOOK_ID`, `HELIUS_WEBHOOK_SECRET`, `SOLANA_RPC_URL`, and `ADMIN_API_TOKEN` are already installed in Vercel. Leave them unchanged.

## 5. Paste these variables into both Railway services

Open the Railway `topblast-launch` project. For both `web` and `rewards-worker`, use **Variables > RAW Editor** and paste:

```text
TOPBLAST_TREASURY_ADDRESS=YOUR_REWARD_TREASURY_PUBLIC_ADDRESS
PROTOCOL_TREASURY_ADDRESS=YOUR_PROTOCOL_TREASURY_PUBLIC_ADDRESS
```

Service-specific variables are already configured:

```text
web: SERVICE_MODE=web
rewards-worker: SERVICE_MODE=worker
```

The Supabase, Helius, admin, worker-limit, StonkFun, dry-run, and launch-gate variables are already installed in both Railway services. Leave them unchanged.

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

Retrieve the already-installed admin token locally without putting it in chat:

```bash
security find-generic-password -a topblast-production -s topblast-admin-api-token -w
```

Open `/admin`, enter that token, and confirm the exact treasury public address and its RPC balance. Do a tiny test transfer before funding it further.

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
