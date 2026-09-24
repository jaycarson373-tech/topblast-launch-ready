# Pre-launch acceptance check, 24 September 2026

Public release: **NO-GO until real fee routing, eligible payouts and restart reconciliation are demonstrated for each supported venue.** Token creation readiness is not reward readiness.

## Verified read-only on production

- WTF Stonk mint: `HLDpWsSiADGC6V3LRthFfLHbrHKqow2gbR7aw6iuX71p`.
- Pool: `64Y4X8RtdBfDi2h7brp77F2Ve1fkVkGzwkuwx8VtEREk`.
- Treasury: `AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42`.
- At the check, WTF history was complete, without tracker errors. No funded reward balances, reward epochs or Pump fee operations existed. No successful holder airdrop is asserted.
- Stonk recognizes this launch and creator in its official token endpoint. Its fees endpoint says creator fees are forwarded automatically, with nothing to claim by signature.
- Standard platform `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`: onchain creatorFeeRate `0`, platform feeRate `10000`, denominator `1000000`. This is not a zero-fee claim: creator revenue is a venue-forwarded share of the platform fee.
- Observed trade `2G2CeKxqqY1FGfhYZJKEdWjGnpLZBcRxPMrRcFZzVeR6qDvfzWks6gnZrQe3VzxiXWtWd4AxFnX2fTzCVTVt2oKW` moved `693000` WSOL atoms into Stonk's shared platform vault `53PrcuNbuYHGh9g3iW7ugdkxaFjF938M5Cwi5SbzwJjQ`, not into TopBlast's treasury ATA.
- The creator quote vault `B2e9rQidVBbJyT3cNf2eZcLfHVRdvDq823AXJrX5fmKy` had zero balance. TopBlast's WSOL ATA `9FswEGaBf4MMDd14TmR1o9VQxukA6nhnsxWJ5GL5hQ8w` had no post-launch fee receipt in its finalized signature history.

## Exact Stonk blocker

`verifyStonkForwardedFee` currently accepts a pool-quote-vault-to-treasury transfer. The actual observed trading fee goes to a shared platform vault. The documented later venue forward needs a real receipt and an authenticated per-token attribution mechanism before the integration can be certified or adapted. Do not credit a shared treasury balance increase to whichever launch is active. Do not substitute arbitrary manual funding for automatic-fee acceptance.

Further inspection of Stonk's public creator UI and its read-only `/api/creator-fees?mint=...&wallet=...` response established a **$5 minimum in accrued creator fees**. WTF reported `accruedRaw=841744`, `forwardedRaw=0`, `pendingRaw=841744`, in WSOL atoms. The UI explicitly says one payment covers multiple tokens against the same quote. `forwardedRaw`, `pendingRaw` and `lastSignature` are creator/quote aggregates; they are not evidence that that amount belongs to this token. Other live summaries include a nonzero historical forwarded total even for a token with zero accrued fees. The creator dashboard now surfaces the live threshold and clearly labels the attribution boundary. No amount of projected fees is added to reward funding.

Official read-only sources:

- https://www.stonkfun.xyz/api/public/v1/openapi.json
- https://www.stonkfun.xyz/api/public/v1/tokens/HLDpWsSiADGC6V3LRthFfLHbrHKqow2gbR7aw6iuX71p/fees
- https://solscan.io/tx/2G2CeKxqqY1FGfhYZJKEdWjGnpLZBcRxPMrRcFZzVeR6qDvfzWks6gnZrQe3VzxiXWtWd4AxFnX2fTzCVTVt2oKW

## Recovery changes in this pass

- Serialize Pump treasury operations across launches. A renewable same-owner database lease is not a mutex for parallel tasks in one worker.
- Refresh only stale unsigned Pump fee preparations. Re-simulate, compare-and-set the unsigned message, renew both leases, persist signed bytes before sending.
- Never rebuild signed, submitted, uncertain or confirmed operations. Missing/failed simulation results stop signing.
- Require the verified version-2 immutable Pump sharing configuration.
- On payout restart, rebroadcast the exact durably stored signed bytes while valid. Never create a replacement payment from a missing RPC response. Expired uncertain transactions stay locked for reconciliation.
- Added explicit simulated tests for expiry, lease loss, competing workers, persistence-before-broadcast, interrupted broadcast, confirmed-payout restart and malformed validity data.

## Acceptance sequence

1. Start with one new Pump mainnet launch. Record its mint and creation signature.
2. Verify the worker's finalized per-mint sharing setup before trading for the fee-routing test. An original treasury-wide creator vault is not a per-launch funding receipt.
3. Choose 100% Holder rewards to test holders only, or a supported 80% Holder / 20% Creator selection to exercise both branches. These are percentages of the distributable 90%, after the fixed 10% protocol allocation.
4. Verify a genuine market buy and retained position. Do not manufacture volume or manipulate a price to force eligibility. A seller or outgoing sender is excluded for that epoch. Above-entry wallets do not qualify.
5. Confirm an actual Pump distribution event for this mint, treasury delta, single-use funding credit and immutable allocation. A gas top-up is not a reward deposit.
6. Verify a complete finalized snapshot and a payable eligible position. The worker reserves 65% of the available holder balance, with 35% retained for later epochs.
7. Observe finalized recipient payout signatures and the matching public proof. For a split test, separately confirm the creator distribution.
8. Restart the worker and check unchanged paid totals, signatures and single-use funding records.
9. Resolve and repeat the Stonk forwarded-fee cycle before advertising both venues as live for automatic rewards.

Local unit tests and unsigned mainnet simulations are not real payout receipts. No funds were moved by the read-only checks in this pass.
