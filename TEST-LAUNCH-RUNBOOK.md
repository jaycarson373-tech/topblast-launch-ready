# Controlled StonkFun and Pump.fun acceptance

Entry: https://topblast-stonkfun-launchpad.vercel.app/launch/test

This is real Solana mainnet, not devnet. Test launches are permanently marked
`is_test=true` before payment. They are excluded from Explore, public token/proof
pages, public holder lookup, and public Supabase reward/funding reads. Creator
lookup still shows the creator's tests. Venue listings, token metadata and chain
transactions are public; this is not anonymous or confidential launching.

## Deployed prerequisites

- Apply `supabase/migrations/202609210001_test_launches.sql` before deploying.
- Use the existing `ADMIN_API_TOKEN` in the test page. It is not a wallet key.
  The page keeps it in memory only. Re-enter after refresh to prepare another test.
- Leave `LAUNCHES_ENABLED=false`, `PUMPFUN_ENABLED=false`, `DRY_RUN=true`,
  `PAYOUT_MODE=manual_wallet`, and epoch planning paused for initial creation.
- The admin-only test path checks configuration, migration, worker heartbeat,
  treasury RPC, mainnet, venue pair and simulation. It does not open public creation.
- Treasury / protocol: `884g5ENyiDoFfqDE8ibDbs88yG3HMpBAg7jsu9nRqMHM`.
  Use a **different creator wallet**. No private keys belong in hosting variables.

## One test per venue

1. Confirm the creator's public address and total spending ceiling before funding.
2. Open the test page and authenticate. Select StonkFun, then Pump.fun for the
   second test. Use clearly named test tokens and review the fixed allocation.
3. Prepare the quote. Review mainnet, fee payer, recipient/program, exact SOL
   payment or simulated debit, expiry and token details. Approve in the wallet
   only after agreeing to that concrete transaction. Preparation does not launch.
4. Keep the original receipt. On timeout/refresh use **Check launch status**.
   Do not create a second launch while the first payment is uncertain.
5. Verify mint, market, finalized creation and tracker activation separately.
   Confirm both test mints are absent from public Explore and token/proof URLs.
6. Prepare and approve a small real buy and attributable creator deposit
   separately. STONK funds StonkFun rewards; Pump deposits wrap SOL into WSOL.
   A plain treasury transfer is not credited to a launch.
7. Only after reviewing the exact funding/payout test, disable dry-run and enable
   epoch planning. Check finalized history, validated price and real eligible loss.
   Do not manufacture eligibility or promise a payout if there is no eligible loss.
8. Treasury wallet approves a concrete payout through Admin. Inspect finalized
   receipts with operator authorization at `/api/token/[mint]`; tests intentionally
   have no public TopBlast proof page. Verify accounting isolation and restart
   recovery without duplicate transfers. Restore pauses after acceptance.

Pump tracking pauses at graduation. Automatic creator-fee routing is not enabled.
Two successful creations alone do not prove the reward cycle or public readiness.

## Stonk integration update, September 21

Stonk retired `/launches/prepare` and `/launches/submit` for new launches.
Its official OpenAPI now documents `/launchlab/pricing?quoteMint=...` as the
supported direct-build path, with automatic Stonk adoption when its exact shape
and platform are used. New launches use the official Raydium SDK instruction,
Stonk's pinned standard platform and its current onchain curve rule. The current
rule requires Token-2022 without a transfer-fee extension. This is not a new venue
or a TopBlast-owned curve. Legacy payment receipts retain their original recovery path.

The browser generates and holds the new mint signer, and the creator wallet signs
the same reviewed message. The server stores the receipt before broadcasting.
Retries reuse identical signed bytes, never another payment or a new blockhash.
Stonk's listing/adoption can lag finalized creation; tracker registration does not
depend on that listing. Trading fees come from verified onchain configuration, not
the retired fee-tier dropdown. Reward funding is still an explicit STONK deposit.

Read-only mainnet verification, no database writes or signatures:

```sh
pnpm exec tsx scripts/verify-stonk-readonly.ts CREATOR_PUBLIC_ADDRESS
```

On September 21, this builder passed mainnet simulation at slot `449127862`
using creator `9J2PyezDKDeF3rr1W3jdKTXkT5nTuBCTgqxiDDjPfpxq` and a random public
mint without a known key. Simulated debit: `8696800` lamports (`0.0086968 SOL`).
This is an estimate, NOT a transaction receipt or proof of a real launch. Prepare
a fresh quote in the browser before approval. No new migration or secret is needed.

Official contract: https://www.stonkfun.xyz/api/public/v1/openapi.json
SDK: https://github.com/raydium-io/raydium-sdk-V2
