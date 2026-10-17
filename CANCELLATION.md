# Whole-order and product cancellation

## API

- `PATCH /api/orders/:id/cancel`: cancel every remaining active item, only before all remaining sellers confirm.
- `PATCH /api/orders/:id/items/:productId/cancel`: cancel the full purchased quantity of one product, only before that product's seller confirms. Other sellers may already be preparing or delivering their portions.

Both endpoints require the customer's authentication cookie, need no body, and
return `200 { order }`. A product ID refers to the purchased snapshot, not today's
catalogue owner or price. Cancelling just part of a line's quantity is not supported.
Repeating a completed cancellation returns the current order without restoring stock
again. Retrying checkout with its original key still returns the original order.

## Stored data and money

Each item has `status: active | cancelled` and optional `cancelledAt`. Missing item
status on old orders means active, unless the entire order was already cancelled.
Original quantities, prices, `totalPaise`, and vendor `subtotalPaise` are preserved.
New `payablePaise` fields on the order and each vendor portion hold the value of
non-cancelled items. Delivery remains free. These amounts include collected amounts
for delivered portions; use `paymentStatus` to distinguish collected from pending.

For example, cancelling two mugs worth 40000 paise from a 120000-paise order leaves
`totalPaise: 120000` and `payablePaise: 80000`. All money remains in integer paise.
New checkouts set payable amounts. Customer and vendor reads supply fallback amounts
for old orders, and sales aggregation falls back to original subtotals. No bulk
migration is needed. Legacy orders lacking vendor portions build them from snapshots
inside the cancellation transaction.

If a seller still has active items, their delivery status stays unchanged. If their
last active item is cancelled, their portion becomes cancelled with payment
not_required and a timestamped history entry. Overall delivery/payment status ignores
cancelled portions. If every item is cancelled, the order becomes cancelled, payment
becomes not_required, and cancelledAt is recorded. Partial cancellation is recorded
on the items, independently of delivery status.

## Transaction and concurrency

Stock restoration, item status, payable amounts and aggregate status commit in one
MongoDB transaction or all roll back. Only newly cancelled items restore stock.
Whole-order and item cancellation share the same service and fulfilmentVersion used
by vendor updates. MongoDB retries write conflicts using fresh data; a seller
confirmation that wins prevents cancellation of that seller's items.

Draft products can regain stock. A missing product returns 409 and rolls back the
transaction. No products are recreated or added to the customer's cart. Cancellation
never collects cash or triggers a refund; only unconfirmed, unpaid portions qualify.
Address edits remain possible while all non-cancelled portions are placed.

Sales summaries and daily charts use payable amounts. Cancelled portions are excluded
from order counts. Top products and CSV/Excel rows exclude cancelled items, including
when their remaining seller portion has been delivered.

## Errors and checks

- 400: malformed order/product ID.
- 401: no authenticated session.
- 404: unknown order, another customer's order, or product absent from that order.
- 409: seller already confirmed, conflicting update, or missing stock record.
- 503: transactions unavailable; use the existing MongoDB replica set or Atlas.

Run `npm run test:cancellation`. The test creates and cleans up its own records. It
covers whole and item cancellation, permissions, stock, retries, rollback, concurrent
cancellations, vendor confirmation races, partial COD amounts, final delivery with a
cancelled seller, legacy orders, history and exports. Regression suites are
`test:orders`, `test:fulfilment`, `test:sales`, `test:csv`, and `test:excel`.

## Frontend integration

My orders supports product and whole-order cancellation with a modal popup confirmation.
Product confirmation names the product and its full purchased quantity. Eligibility
uses the item's own seller; whole-order and address editing eligibility ignore
cancelled portions. The server remains authoritative if status changes meanwhile.

Both customer and vendor screens label cancelled items and their cancellation times.
COD amounts use payablePaise with legacy fallbacks, including the vendor collection
checkbox. Original totals remain separately labelled when they differ. Failed
requests require refreshing the order before retrying; repeated backend calls remain
safe. Competing actions are disabled while a confirmation is open.

Frontend checks: `npm run test:orders`, `npm run build`, and ESLint for changed files.

