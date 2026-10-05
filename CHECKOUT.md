# Checkout and My orders

## Follow a Place order click

1. Cart links to /checkout after refreshing prices and availability.
2. Checkout.tsx collects an Indian delivery address and displays Cash on Delivery.
3. POST /api/orders sends the address, a random checkout key, and the cart summary
   the user reviewed. It never sends a trusted total or user ID.
4. routes/orders.js requires authentication; orderController.js validates fields.
5. orderService.js reads the authenticated user's cart and current products.
   If quantities, prices, publication or stock changed, it rejects checkout.
6. A MongoDB transaction reduces stock, creates the Order, and removes those cart
   rows together. Any failure rolls everything back. Concurrent checkouts cannot
   consume the same remaining stock.
7. Checkout refreshes Zustand from the saved cart and opens /orders.
8. Orders.tsx fetches that account's order history, ten orders per page.

## Why snapshot products?

Order items copy the product name, image, quantity, vendor and unit price.
Renaming a product or changing its price cannot rewrite purchase history.
Money is saved and added in whole paise (100 paise = INR 1), avoiding decimal
addition errors. The backend calculates the total. Delivery is always zero
and paymentMethod is cod. New orders have paymentStatus pending and status placed.

## Why a checkout key?

The UI blocks repeated clicks. A unique user/checkoutKey index also prevents
duplicate orders when requests race or a successful response is lost. Retrying
the same attempt returns the existing order even though its cart was cleared.
After an uncertain server/network result the form keeps the same request and
locks address editing. Review My orders before beginning another checkout.
The pending retry is kept in component memory; reloading or leaving checkout
does not preserve that key. Check My orders if a response was lost before a reload.

## Local MongoDB

Checkout needs transactions, supported by Atlas or a replica set. The local
MongoDB Windows service was configured with replSetName: shoppy-rs and initialized
with one member at 127.0.0.1:27017. It remains bound to localhost. Existing data
was preserved. The previous configuration is backed up beside mongod.cfg as
mongod.cfg.before-shoppy-replica.bak.

The one-time scripts are scripts/setup-local-mongo-replica.ps1 (requires Windows
administrator rights) and scripts/init-local-mongo-replica.cjs (initialization).
Do not run them against a different MongoDB deployment.

## Checks

Backend: npm run test:orders and npm run test:cart.
Frontend: npm run build, npm run test:cart and lint for the changed components.
Order tests create temporary accounts/products/orders and remove them afterward.
They cover invalid addresses, authentication, transaction rollback, price changes,
duplicate requests, competing checkouts, order ownership and product snapshots.

## Later

Delivery status changes, vendor order management, cancellations, and recording
collected cash are future work. This version displays Placed and Payment pending.


## Editing an order address

My orders shows Edit delivery address only for placed orders. The prefilled form
sends PATCH /api/orders/:id/address with the full address. The backend reuses
checkout address validation and updates using {_id, user, status: 'placed'} as
one database filter. A single-document update is atomic, so this needs no
multi-document transaction. Missing or other-account orders return 404; a user's
own order that has moved beyond placed returns 409. Stock, prices, payment and
cart are untouched. The UI shows the saved address and retains edits after errors.
OrderAddressEditor.tsx handles the form; addressFields.ts shares field definitions
with Checkout.tsx. npm run test:orders includes ownership, invalid addresses,
persisted changes and locked-status checks.