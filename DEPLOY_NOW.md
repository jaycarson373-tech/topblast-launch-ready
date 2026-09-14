# TopBlast Launch: go-live checklist

The web app is deployed at `https://topblast-stonkfun-launchpad.vercel.app`. Keep `LAUNCHES_ENABLED=false` until every health check passes.

## 1. Create Supabase and paste the schema

1. Create a Supabase project.
2. Open **SQL Editor**, choose **New query**, paste the complete contents of:
   `supabase/migrations/202609130001_topblast_multilaunch.sql`
3. Click **Run** once.
4. In **Project Settings > API**, copy the project URL and service-role key.

The migration is idempotent only at the initial project level. Do not paste it twice into an already partially-created schema.

## 2. Add Vercel environment variables

Open **Vercel > topblast-stonkfun-launchpad > Settings > Environment Variables**. Add these to Production:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
HELIUS_API_KEY=YOUR_HELIUS_KEY
HELIUS_WEBHOOK_SECRET=GENERATE_A_LONG_RANDOM_SECRET
TOPBLAST_TREASURY_ADDRESS=YOUR_REVIEWED_SOLANA_TREASURY
PROTOCOL_TREASURY_ADDRESS=YOUR_REVIEWED_PROTOCOL_TREASURY
ADMIN_API_TOKEN=GENERATE_A_DIFFERENT_LONG_RANDOM_SECRET
DRY_RUN=true
LAUNCHES_ENABLED=true
```

Never prefix the service-role key, Helius key, webhook secret, treasury signer, or admin token with `NEXT_PUBLIC_`.

## 3. Configure Helius

Create an enhanced-transaction webhook targeting:

```text
https://topblast-stonkfun-launchpad.vercel.app/api/indexer/helius
```

Send the header:

```text
Authorization: Bearer YOUR_HELIUS_WEBHOOK_SECRET
```

Add every new launch mint and market address to the webhook after the launch reaches `active`. Validate one real LaunchLab buy, one sell, and one transfer before leaving launch mode enabled.

## 4. Redeploy and verify

```bash
npx vercel --prod --yes
pnpm verify:production
```

`GET /api/health` must return HTTP 200 with `"ready": true`. If it returns 503, do not launch yet. The response names the missing configuration without exposing values.

## 5. Railway

The included `railway.toml` runs the Next.js service and checks `/api/health`. Connect the same GitHub repository, copy the same server-side variables, and set `NEXT_PUBLIC_APP_URL` to the Railway domain if Railway is the primary host.

For a separate reward-worker service, override its start command:

```text
pnpm worker:rewards
```

Leave `DRY_RUN=true`. Live payouts intentionally remain blocked until a reviewed server-side signer or multisig approval provider is connected.
