> September 15 update: StonkFun and Pump.fun creation paths are implemented, and all four database migrations are applied. Production launches and payouts remain gated pending treasury public addresses and controlled real-money acceptance. The user confirmed that the old `topblast-launch` Railway project belongs to the rebranded Robinhood product. Do not deploy this repository there. This launchpad now has a separate Railway project, `topblast-stonkfun-launchpad`, with one reward worker; its website remains on Vercel. A passed build or read-only simulation is not a completed launch-to-payout cycle.

## September 15: exact remaining setup

1. Supply `TOPBLAST_TREASURY_ADDRESS` and `PROTOCOL_TREASURY_ADDRESS`, both public Solana wallet addresses. The reward wallet must be connectable to approve payouts. No private keys go into Vercel or Railway.
2. Supabase is complete. The fourth migration was applied through the signed-in editor, and production health confirms `pumpSchemaReady=true`. Railway ownership is resolved: use only the launchpad project and service IDs below, not Robinhood's old `topblast-launch` project.
3. Keep `LAUNCHES_ENABLED=false`, `PUMPFUN_ENABLED=false` (default), and `DRY_RUN=true` until the addresses are installed and reviewed. `PUMPFUN_ENABLED=true` enables the second venue only after its migration and controlled acceptance setup. No Pump.fun API key is required.
4. Creator wallet: fund the amount shown by the simulated launch review. Reward treasury: fund transaction fees in SOL, then use each launch's creator deposit action to fund its isolated ledger. A plain transfer to the treasury is not attributed reward funding. Pump.fun deposits wrap SOL into WSOL; Pump.fun payouts use WSOL. StonkFun uses STONK. No swap is involved.
5. During controlled acceptance, enable launches, set `DRY_RUN=false`, and use **Admin > Enable epoch planning**. Creator signs creation and funding; treasury wallet signs the reviewed payout. Verify finalized public proof, restart recovery, and two-launch isolation before public opening.

Pump.fun scope: regular SOL-paired `create_v2` coins, verified curve buys/sells/transfers, creator deposits, WSOL payout preparation and proof. Pump.fun native holder rewards are not selected because Pump.fun controls that distribution and its fees cannot fund TopBlast. Creator fee claims currently occur on Pump.fun. Creator vaults can combine fees from several coins, so their balance is never booked as per-launch revenue. Tracker and rewards pause at graduation; PumpSwap migration tracking is not implemented yet. USD metrics remain unavailable rather than estimated.

Read-only mainnet evidence: decoded buy [3yuj7h4aEiJaPWuAoVenKuSTktjKu9RxwazwG4ynMCC7xebFwGJTLXjPFfYpHx28wzDWxY523i2KnS6Ntwj2qb7J](https://solscan.io/tx/3yuj7h4aEiJaPWuAoVenKuSTktjKu9RxwazwG4ynMCC7xebFwGJTLXjPFfYpHx28wzDWxY523i2KnS6Ntwj2qb7J), slot 447237789. Official creation simulation passed with 97,358 compute units. Neither transaction creation nor payout was signed or broadcast by this check. Run `pnpm exec tsx scripts/verify-pump-readonly.ts` to repeat a read-only recent-trade and creation-simulation check.

Current infrastructure update: Vercel and the production Supabase schema are configured. The dedicated Railway worker has the launchpad's existing Supabase and Helius settings, with `DRY_RUN=true`, launch flags disabled, and `PAYOUT_MODE=manual_wallet`. Secret values were transferred directly without writing them into source or logs. Check the worker deployment and heartbeat before activation. Do not recreate working credentials. The wallet inputs still required are the reward and protocol treasury **public addresses**.

# TopBlast Launch: exact go-live runbook

Production web URL: `https://topblast-stonkfun-launchpad.vercel.app`

Repository: `jaycarson373-tech/topblast-stonkfun-launchpad`, branch `main`.

Runtime: Node `22.x`, pinned in `package.json` for both Git-based and CLI builds. The installed Supabase client requires Node 22+; Node 20 fails during worker startup. Validate using `pnpm test` on Node 22 before deployment. Railway uses `pnpm railway:start` and `/api/live` as its health check.

Railway project: `topblast-stonkfun-launchpad` (`335e8194-a55f-4178-ad02-3d7e488d7fdd`).

Production environment: `42b3d12d-9aed-4f56-aefb-47198927927b`.

Only Railway service: `rewards-worker` (`f654f144-44db-4d5c-8def-44a742061b78`). No Railway web service is needed because Vercel serves the website and API.

The separate repository `jaycarson373-tech/topblast-robinhood` and Railway project `topblast-launch` belong to Robinhood. Never use that project's service IDs in this launchpad's deployment commands.

Keep `LAUNCHES_ENABLED=false`, `DRY_RUN=true`, and `reward_engine_paused=true` until every check below passes.

## 1. Supabase is complete

All four production migrations have been applied to the existing `Topblast` Supabase project (`pmbrkwohiaapxcouoiux`). Vercel and the new dedicated Railway worker have its URL and server-side service-role credential. Do not recreate Supabase or replace working Vercel credentials.

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

## 5. Set these variables in the dedicated Railway worker

Open Railway `topblast-stonkfun-launchpad` > `rewards-worker` > **Variables > RAW Editor** and paste:

```text
TOPBLAST_TREASURY_ADDRESS=YOUR_REWARD_TREASURY_PUBLIC_ADDRESS
PROTOCOL_TREASURY_ADDRESS=YOUR_PROTOCOL_TREASURY_PUBLIC_ADDRESS
```

Service-specific variables are already configured:

```text
rewards-worker: SERVICE_MODE=worker
```

The Supabase, Helius, worker-limit, StonkFun, dry-run, and launch-gate variables are already installed in this worker. Leave them unchanged. Admin authorization belongs to the Vercel API and does not need to be duplicated into the worker.

The worker source is this launchpad repository on `main`. For a deliberate CLI deployment, use explicit targets:

```bash
npx @railway/cli up -p 335e8194-a55f-4178-ad02-3d7e488d7fdd -e 42b3d12d-9aed-4f56-aefb-47198927927b -s f654f144-44db-4d5c-8def-44a742061b78 --detach
```

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

After treasury review, change `LAUNCHES_ENABLED=true` in Vercel and the dedicated Railway worker, then redeploy. Enable `PUMPFUN_ENABLED=true` in both only when including Pump in controlled testing. `/api/health` must report the selected venue's `launchReady=true`; this does not certify rewards or replace the acceptance cycle.

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
