# Vendor sales backend

The vendor frontend is at /vendor/sales, accessible through the Sales header link.
It shows summary cards, date filters, manual refresh, Recharts bar charts and a
top-products table. The charts are loaded on demand with React.lazy.
Blank dates mean all time; either date can also be supplied alone.

GET /api/vendor/sales requires a signed-in vendor. Optional from and to query
parameters use YYYY-MM-DD, for example:

    /api/vendor/sales?from=2026-10-01&to=2026-10-31

Both dates are inclusive calendar days in Asia/Kolkata. Either can be omitted;
omitting both reports all time. Invalid dates or reversed ranges return 400.
Filtering uses order placement time (createdAt), not delivery/collection time.
So this is the current progress of orders placed during the selected period,
not a cash-flow report of money collected during that period.

## Response meanings

currency is INR. All money fields are integer paise; divide by 100 for rupees.
summary contains:

- orderCount: number of orders containing this vendor's portion.
- deliveredOrderCount: number of this vendor's delivered portions.
- orderedValuePaise: sum of this vendor's purchased subtotals.
- deliveredSalesPaise: subtotal of delivered portions.
- collectedCodPaise: subtotal of portions marked collected.
- pendingCodPaise: subtotal of portions with collection pending, including
  unshipped orders. This is expected COD, not overdue debt or transferred money.

topProducts contains up to five products ranked by delivered quantity, then
delivered sales, then product ID for deterministic ties. Each entry includes
productId, name, deliveredQuantity and deliveredSalesPaise. Names come from the
latest purchased snapshot in the selected period. Historical prices and vendor
ownership come from orders, never today's product records.
Empty reports return zeros and an empty topProducts array.
Legacy orders without vendorOrders must first be backfilled with migrate:orders.

dailySales contains from, to and a days array. Each day has date, orderCount and
orderedValuePaise. Days with no orders are included as zeros. Dates are grouped
in Asia/Kolkata with MongoDB $dateToString, using only this vendor's subtotal.
The graph shows at most 30 days ending on to, or today when to is absent. A
later from shortens that window; a future from without to gives a single-day
window starting on from. The response explicitly labels the chart's date range.
Summary and topProducts still cover the full selected period, even if longer
than 30 days. Daily ordered value includes orders awaiting delivery/payment.

## Follow the code

routes/vendor.js applies authentication, vendor authorization and no-store caching.
controllers/vendorSalesController.js validates dates and converts India calendar
days to an inclusive start and exclusive end instant.
services/vendorSalesService.js runs one MongoDB aggregation:

1. $match selects this vendor's orders and the placement date range.
2. $unwind turns vendorOrders into one row per vendor portion.
3. A second $match removes all other vendors' portions. Skipping this step would
   accidentally count other sellers' sales in a shared order.
4. $facet produces the summary, top-products list and daily totals from the same input.
5. $group and $sum calculate counts and totals. $cond selects delivered or
   collected portions. The product branch unwinds items and filters vendor again.
6. $sort and $limit rank the top five products.

The authenticated account supplies the vendor ID; query parameters cannot change
it. This endpoint only reads data and exposes no buyer addresses or account IDs.
No new backend dependency or schema migration is required for this feature.

## Follow the chart data to the screen

1. The sales API returns integer paise, quantities and India calendar dates.
2. VendorSales.tsx fetches the report and stores it in React state. Date changes
   and Refresh fetch a new report; old requests are aborted.
3. VendorSalesCharts.tsx converts daily paise to rupees for display only.
4. ResponsiveContainer measures the available space. BarChart takes the array;
   XAxis/YAxis choose labels and scales, Bar draws values and Tooltip formats them.
5. The daily graph is vertical; delivered product quantities are horizontal.
   CSS variables colour the bars, grid, axes and tooltips in both themes.
6. The daily values table and original products table keep exact data available
   without relying on hovering. Recharts keyboard accessibility is enabled.

The frontend installs recharts and react-is matching the installed React version,
following the library's installation guide:
https://github.com/recharts/recharts/blob/main/README.md#installation

Run npm run test:sales with MongoDB available. The smoke test creates temporary
accounts/orders and cleans them up, covering roles, multi-vendor isolation,
totals, historical snapshots, empty reports, daily zero filling, 30-day limits,
leap days and India date boundaries.
