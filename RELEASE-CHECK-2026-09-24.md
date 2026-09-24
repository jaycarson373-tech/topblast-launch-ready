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

## Follow-up: live Pump fees and creator payouts

New Pump test mint `7vt4NxCCBRtyj4kkpiKNZRnHbgJkAww4qsDn4DxKeaM`, launch `7e72be4f-4503-44ec-9ed7-d724880a0e5d`:

- Immutable per-mint setup confirmed at slot 450048324: `43Y6Vv2HZ65WZ8tzNG1eMRruAopV11g8naZ5Zk8MzN9JGW4Y9PgG2g4dCDAwmBUCqMCEgbkBfM9qidLTnxnXWcnU`.
- Three automatic fee receipts credited 241604, 3422271 and 9007403 atoms. Holder allocation available: 9123319 atoms. These are actual confirmed receipts, not estimates.
- Three creator distributions to `7NUcj2PUpASAbu5pPjKg4DULyhb9SD7yZsPN9zfk4EJ9` total 2280828 WSOL atoms. Finalized RPC independently confirmed successful checked transfers. Signatures: `VogSJWudUhTuD7U7gseraj5AkswdgDLyhYwkbEwv6WtLwrHHiTjSKmkeJGovnsW8sx1Yf55puGRoqEbaHZDDoQx`, `3Cv9xw2txsLyb7TZNTaYcTLpwKyV6kusYEvccFT94tbShEvTv45hifDu64Uu6MFdoRJYjaU7KHM7V2jWbj28AMdJ`, `28R6tKjLGAgaykMcHy32oZuLxExYuF2nFmWVWULZiJGZz15onAcrWHhEeSRMneRZPc2pb4ZDPKZTQnJPUeuU5XQE`.
- First epoch completed at snapshot slot 450052030 with no payable allocations: five `SOLD_THIS_EPOCH`, one `NOT_A_VERIFIED_BUYER`. Reserved funds were returned to available. No holder payout is asserted.
- Collection `47urtTnyEiS8o3oAuD2W4sEyjYaW9zEGoLyBDH7uUh6rpx1JAcAmbLZkqDCbLpnCCNqjTUDy84m6zrgxbh3a5qdm` finalized successfully with zero distributed at slot 450049981. Its treasury delta was exactly the 5000-lamport network fee. The old positive-only verifier left it stuck. Recovery now retains a confirmed empty receipt with no funding credit, and the worker rejects zero distributable balance before attempting another collection. No migration is needed; empty amount stays null and the verified zero is recorded in proof.
- Stonk pool-vault transfer inference has been removed: a treasury sell can produce that same transfer. Standard Stonk fee credit remains blocked, now explicitly reported in health, launch review and worker diagnostics. The current public fee API is not an authenticated per-token payment ledger.

### Exact Stonk integration dependency

Request from Stonk: a supported authenticated receipt for each forwarded payment, containing its signature, creator, quote mint, and exact raw amount per token mint. The token allocations must sum to the finalized received amount, have stable single-use identifiers, and support pagination/recovery. Creator/quote aggregate totals and token lifetime accrual alone cannot establish the payment split. An alternative is a separately designed per-launch receiver scheme; that is a custody/launch architecture change, not a safe retrofit to already-created shared-receiver launches.

Public release remains NO-GO pending that Stonk integration and a genuine eligible-holder payout plus restart verification. No transaction was manually signed or sent by these read-only acceptance checks; the deployed worker executed the user-enabled automatic operations.
