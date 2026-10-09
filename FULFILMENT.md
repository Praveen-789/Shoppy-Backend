# Vendor fulfilment: learning walkthrough

## Try the feature

1. Sign in as a vendor and open Incoming orders (/vendor/orders).
2. Each card contains only that vendor's purchased products, COD subtotal,
   recipient details, status and history.
3. Advance through Placed -> Confirmed -> Packed -> Shipped ->
   Out for delivery -> Delivered.
4. The final step requires explicitly confirming delivery and cash collection.
5. Sign in as the customer, open My orders and click Refresh orders.
   Each vendor's delivery and payment state appears separately.

The screens fetch on opening and provide manual refresh. No automatic live updates
or payment transfers are implemented. Cash collection is a vendor-entered  record.

## Data design

Order.items remains the purchased product snapshot. Order.vendorOrders stores
one portion per vendor: vendor ID/name, subtotalPaise, status, paymentStatus and
timestamped history. buildVendorOrders in services/fulfilment.js groups items
by their saved vendor IDs and adds their purchased line totals in integer paise.
Checkout creates these portions inside the same transaction as stock reduction,
order creation and cart removal.

Example: shoes and socks from vendor A have one subtotal and delivery history.
A backpack from vendor B has another. Vendor A completing delivery must not
change vendor B's portion.

The overall status equals the shared status when all portions match. Otherwise
it is processing, or partially_delivered when at least one portion is delivered.
Only all delivered portions make the entire order delivered. Payment similarly
moves from pending to partially_collected to collected.

## Node/Express flow

routes/vendor.js already applies requireAuth and requireVendor.
GET /api/vendor/orders?page=1 calls vendorOrderController.list.
PATCH /api/vendor/orders/:id/status calls vendorOrderController.update with:

    { expectedStatus: 'placed', status: 'confirmed', cashCollected: false }

The controller validates IDs, status strings, booleans and page numbers.
vendorOrderService checks ownership and allows only the next sequential step.
The server derives payment changes itself; supplied totals/vendor IDs are ignored.
A failed ownership check returns 404, invalid input 400, and stale or skipped
transitions 409. Delivered portions are terminal.

## MongoDB concepts used

The list query filters on vendorOrders.vendor, backed by a compound index.
vendorView returns only the requesting vendor's items and portion, without the
other vendors' subtotals or the order's internal checkout key/customer account ID.

The write uses $elemMatch to ensure vendor and expected status belong to the
same array element. arrayFilters targets that vendor's portion. $set updates
its status/payment, $push appends history and $inc advances fulfilmentVersion.

Overall order status is calculated from a read of all portions. To avoid saving
a stale calculation when two vendors update at once, the write requires the
same fulfilmentVersion that was read. Only one competing write can match that
version. The other returns 409 and refreshes before retrying. This is optimistic
concurrency control: a version check instead of holding an application lock.

All fulfilment changes affect one Order document, so the update is atomic and
does not need a multi-document transaction. It never alters product stock again.

## Address safety

Address editing is allowed only while the overall order is placed and no vendor
portion has progressed. The address update includes both conditions in its
database filter. A confirmation racing an address edit therefore either happens
after that edit or prevents it. A late confirmation response contains the latest
saved address.

## Existing orders and tests

npm run migrate:orders groups existing snapshots without changing prices, totals,
stock or cart. Its conditional update makes rerunning safe. History begins with
the saved order's current status and original creation time; earlier transitions
cannot be reconstructed.

npm run test:fulfilment creates temporary multi-vendor orders and cleans them up.
It covers grouping, role/ownership permissions, response privacy, invalid/skipped
steps, duplicate/stale and concurrent writes, final COD confirmation, address
locking, unchanged stock and idempotent migration.
npm run test:orders checks checkout and address editing regressions.

## Files to read in order

models/Order.js -> services/fulfilment.js -> controllers/vendorOrderController.js
-> services/vendorOrderService.js -> routes/vendor.js.
Frontend: src/orderTypes.ts, components/VendorOrders.tsx, components/Orders.tsx,
and components/OrderTimeline.tsx.
