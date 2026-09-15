# Test TopBlast now

Open https://topblast-stonkfun-launchpad.vercel.app/test and press **Run full rehearsal**.

No wallet, SOL, STONK, Supabase setup, or environment variables are needed for this test.
The page uses the production position and allocation calculations with fictional data.
Launch creation, funding, payment acknowledgments, slots, and wallets are simulated.
It is not devnet and does not establish that the live payout pipeline works.

Try selling, incoming/outgoing transfers, price above entry, and zero funding. For local refresh recovery, use **Run next step** four times, refresh at **Sample payout interrupted**, then continue. **Replay recovery check** must not increase the unique simulated payment count. SIM-B must remain unfunded and unpaid.

## Actual production state checked September 15

- Vercel site and Railway worker deployed.
- Existing Supabase connected. Do not create another database for this rehearsal.
- Helius configured; worker heartbeat recent; STONK pair available.
- No real launch or launch → funding → payout acceptance receipt yet.
- Live launches locked; DRY_RUN=true; epoch planning paused.
- Pump.fun deferred and hidden unless explicitly enabled.

The official StonkFun API at https://www.stonkfun.xyz/api/public/v1/openapi.json lists one server and no documented devnet endpoint or cluster selection. Do not change the production RPC to devnet while using this launch API.

## What the operator still needs to provide for real testing

Public addresses only:

```text
TOPBLAST_TREASURY_ADDRESS=<wallet that will receive STONK rewards and approve payouts>
PROTOCOL_TREASURY_ADDRESS=<wallet that will receive the protocol portion>
```

These can be the same address, but the creator depositing STONK must use a different wallet. Never send private keys or seed phrases. The current payout mode uses explicit wallet approval, not a Railway private key.

After these addresses are configured on Vercel and Railway, verify the live readiness checks and enable controlled launches. Review the venue's exact quoted SOL fee, recipient, fee payer, and mainnet network before approving one test launch. Do not fund an arbitrary 10 SOL balance. The quote determines the launch payment; later transaction reviews determine additional costs.

STONK rewards require an explicit creator STONK deposit. SOL in the treasury only pays transaction fees. Automatic fee routing is not enabled. To test deposits/payouts, the operator must deliberately turn DRY_RUN off after review; epoch planning must also be enabled. Each payout still requires the treasury wallet's approval.

Before public release, demonstrate and retain real receipts for a verified buy, attributable funding, finalized eligibility, funded allocation, confirmed payout, public proof, and a worker restart with no duplicate payment. Repeat isolation with a second launch. A successful rehearsal does not satisfy those requirements.

## Repeatable developer checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
TEST_URL=https://topblast-stonkfun-launchpad.vercel.app pnpm test:e2e
pnpm verify:production -- --smoke
```

Browser tests use an isolated Google Chrome session with no wallet. They verify desktop/mobile rehearsal controls, partial local recovery, zero funding, exclusions, no payment submissions, and live-status error handling. Production smoke checks are availability checks only. Strict `pnpm verify:production` must remain failing until actual readiness gates are satisfied.
