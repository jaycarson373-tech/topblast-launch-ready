# Stonk isolated fee wallets

Applies to new launches prepared after migration `202609240002_stonk_isolated_receivers.sql` and the matching worker/web deployment. Existing shared-recipient launches are not silently migrated or credited by volume estimates.

## Actual flow

1. Railway provisions eight public receiving addresses. Their keys are derived in worker memory from the existing treasury secret and a permanent random receiver UUID. No private key is stored in Postgres or sent to Vercel.
2. Preparing a Stonk launch permanently binds one address to its mint. Retrying the same mint returns the same address. The onchain market uses that address as its fee recipient. The customer still pays and signs the launch transaction.
3. After the launch and market are verified, the worker sends exactly **0.01 SOL once** from the main treasury to the receiver for operating gas. It requires spare operating SOL above protected liabilities plus a 0.005 SOL treasury reserve. This SOL is not reward funding.
4. Stonk controls fee forwarding and its minimum thresholds. The worker cannot force a venue payment or infer received fees from trading volume.
5. The receiver's verified quote-token balance is swept to the main treasury. Each sweep is bound to one launch, exact mint and amount, with finalized transaction evidence. A receiver can also accept voluntary deposits, so the proof calls this *attributable funding*, not exclusively venue fees.
6. Once the tracker has indexed through the receipt slot, a database transaction credits that launch's immutable holder/creator/protocol split. Existing epoch and payout workers consume it. No other launch can reuse that receipt.

## Configuration and key backup

No new private-key variable is required. Existing Railway-only `TREASURY_PRIVATE_KEY` must match `TOPBLAST_TREASURY_ADDRESS`. `DRY_RUN=false`, `PAYOUT_MODE=server_signer`, and `TOPBLAST_MAX_PAYOUT_ATOMS` control execution. The latter caps each sweep, not the total fee stream. Vercel uses only the public treasury address and its existing server-side database credential.

**Back up the original treasury key securely and retain receiver UUID/address records.** Changing the master key does not migrate receiver balances. An old receiver needs its original master secret and UUID to recover funds. Do not rotate that key casually, paste it into chat, or put it in Supabase, Git, browser storage or public environment variables.

The 0.01 SOL top-up is not an unlimited auto-refill. Exhausted receiver gas is an operator recovery issue. Never use holder allocations to refill it. Do not manually replace a signed operation that is awaiting reconciliation.

## Restart and failure behavior

- Wallet bindings and transaction intent are immutable.
- The database permits only one gas operation per receiver and one inflight sweep per receiver.
- Signed bytes are saved before broadcast. Retries broadcast those same bytes only.
- A missing expired receipt becomes uncertain. It is not replaced with a newly signed payment.
- A failed or unavailable RPC response cannot establish funding.
- Finalized sweep credit is atomic and idempotent. Creator receipts and public proof remain separate from holder allocations and confirmed payouts.
- A paused launch stops new receiver operations. Re-enable only after reviewing outstanding signed receipts.

## Acceptance still required

Local simulations and database tests cover isolation, duplicates, restart recovery, gas protection and immutable receipts. Deployment and wallet provisioning alone are **not** a passed live reward cycle.

For one new Stonk launch verify: selected receiver in the confirmed market, one 0.01 SOL gas receipt, actual venue quote-token forwarding, finalized sweep, one funding credit, finalized eligible holder snapshot, confirmed holder payout and unchanged totals after restart. Do not manufacture volume or credit projected fees to make this pass.

Optional launch-time dev buys and native-SOL payouts are not introduced by this change. Quote-token payouts retain the existing asset, including WSOL for a WSOL market.
