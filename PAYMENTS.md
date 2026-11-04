# ZIMOVA payments: what exists and what a real gateway still needs

## What is built (and tested)
- Every payment is a record in a ledger (`payments`): amount, driver share (90%), ZIMOVA commission (10%), method, status, provider reference.
- A payment only becomes **paid** when the provider calls `POST /api/webhooks/payments` with a valid signature (HMAC-SHA256 of the raw body using `PAYMENT_WEBHOOK_SECRET`). Wrong signature, unknown reference, wrong amount and repeated webhooks are all handled and tested.
- Duplicate payments are blocked: one pending/paid payment per trip, plus a lock against simultaneous clicks.
- Failed payments can be retried. Admin can refund a paid payment (driver balance is reduced; if already paid out it is deducted from the next payout).
- Driver wallet: available, pending payout, paid out, daily/weekly earnings, per-trip commission, transaction history.
- Daily payouts: once per day at `PAYOUT_HOUR` (or "Run payouts now" in Admin > Payouts). Each payout lists the exact payments it covers, so nothing is paid twice.
- Reconciliation (Admin > Payments): checks that driver share + commission + fee equals each payment, flags stale pending payments, failed/pending payouts and payouts that exceed earnings.

## What is NOT real yet
`PAYMENT_PROVIDER=sandbox` is a stand-in that behaves like a gateway (it calls your webhook after about a second). **No real money moves.** To go live you must:
1. **Choose a provider and open a merchant account.** I have not verified any Zimbabwean provider's API, fees, or whether it supports automatic marketplace splitting and driver payouts, so I have not written an adapter. Check this with the provider *before* committing.
2. If the provider cannot split payments or pay drivers out by API, use this model (already how the ledger works): collect the full fare into ZIMOVA's merchant account, record the 90/10 split in the ledger, and pay drivers daily from that balance by the provider's bulk/mobile-money payout feature, or manually from the Payouts tab using the payout list. Tell drivers this clearly.
3. **Write the adapter**: add an entry to `providers` in `lib/extra.js` with `charge(payment)`, `refund(payment)`, `payout(payout)`. Replace the webhook signature check with the provider's own verification scheme, and add a status check (polling) as a backup in case a webhook is missed.
4. Set `PAYMENT_PROVIDER`, the provider's credentials and `PAYMENT_WEBHOOK_SECRET` as environment variables on the server. Never put them in frontend code.
5. Test with the provider's test environment: successful payment, declined payment, refund, duplicate webhook, payout, and a payment whose webhook never arrives.
6. Rules for holding customer money, mobile-money limits, and driver tax or licensing obligations in Zimbabwe need to be checked with the provider and a local adviser.
