# CSV streaming — lesson 1

## Styled Excel download

Sales also offers **Download Excel** at `/api/vendor/sales/export.xlsx`, using the
same vendor-only guards, snapshots and inclusive India date filters as CSV.
`salesExcelService.js` uses ExcelJS, an application dependency, to build one Sales
worksheet with wrapped text, generous widths, shaded bold headers, frozen headers,
filters, alternating rows and numeric INR cells. Order IDs remain text; dates are
real Excel dates labelled UTC; formula-looking product names remain plain text.

Unlike the CSV pipeline, this first Excel version assembles a workbook and its
ZIP buffer in memory before sending it. It has a 10,000-product-row limit and
returns 422 with guidance to narrow dates or use CSV when exceeded. The database
still uses a cursor. Normal failures, row-limit failures and disconnects close
that cursor. Large-scale Excel exports could later use a streaming writer or a
background report job. Extremely long names can need manual row-height adjustment
because Excel rows have a maximum height. Run `npm run test:excel` for round-trip
workbook, API and access tests.

ExcelJS API reference: https://github.com/exceljs/exceljs#readme

Restart the backend, sign in as a vendor, and open Sales. Click **Download sample
CSV**. Open `shoppy-demo-sales.csv` in a text editor first, then Excel if available.
This contains three fixed examples, not your actual sales. Dates do not affect it.

Read `controllers/salesCsvController.js` from top to bottom:

1. `Content-Type` describes the body as CSV text encoded in UTF-8.
2. `Content-Disposition` asks the browser to download it using our filename.
3. `response.write()` adds one chunk to Node's outgoing response buffer.
4. `\r\n` ends a CSV row (carriage return plus newline).
5. `response.end()` finishes the response. Without it, the download can stay open.

Set headers before writing: the first write sends the response headers. After
that, you cannot replace the response with a JSON error or change its status.
Express's response extends Node's HTTP response, a writable stream. Individual
writes need not arrive as separate chunks at the browser; buffering can combine them.

The route is `GET /api/vendor/sales/demo.csv`. Existing authentication and vendor
middleware run before the controller. The frontend uses a normal link, so the
browser sends the session cookie and handles downloading without building a Blob
of the whole response in React memory.

## Try two small experiments

- Change the mug quantity, restart the backend, and download again.
- Add another fixed `response.write()` before `response.end()` and see the new row.

Keep values simple for now. A comma or quote in a product name needs CSV escaping,
which we will handle before exporting real database values.

## Why this is only lesson 1

This tiny response demonstrates writes and headers. It does not demonstrate
reading a large dataset or slowing down when the browser is slow. `write()` can
return `false`: Node accepted that chunk, but wants us to pause before adding
more. Our fixed tiny example is bounded; a database export must respect that
signal, or use `pipeline()` to manage backpressure.

## Lesson 2: real orders with a cursor (implemented)

Sales now links to `GET /api/vendor/sales/export.csv`. Apply your dates first;
the download follows the applied period, using the same inclusive India calendar
days as the dashboard. The old demo endpoint remains available for lesson 1.

Read `services/salesCsvService.js`:

```js
Order.find(filter)
  .select('_id createdAt items vendorOrders')
  .sort({ createdAt: -1, _id: -1 })
  .lean()
  .cursor({ batchSize: 100 });
```

`find()` describes the query. `select()` avoids fetching customer details.
`sort()` makes newest orders come first, using the vendor/date index.
`lean()` returns plain objects instead of full Mongoose documents. `cursor()`
reads results gradually; MongoDB fetches batches of up to 100 orders here.
We never build an array containing all matching orders.

The controller reads the first order before sending headers so an initial database
error can return JSON. The generator exports that order, then uses
`for await (const order of cursor)` to read the remaining orders. `yield` supplies
one text chunk at a time. The first chunk contains the header and a UTF-8 BOM to
help Excel recognize non-English product names.

An order can contain multiple vendors. We filter both the matching orders and
their items, then use only this vendor's delivery and COD status. One CSV row
represents one purchased item. All statuses are included, not just delivered
sales. Names and prices come from order snapshots. Prices and totals are INR with
two decimal places; timestamps are explicitly UTC. Empty results give a header
only. This is a fresh query, not a frozen copy of the dashboard's earlier result.

`csvCell()` quotes fields and doubles embedded quotes. This handles commas,
quotes and newlines in product names. Formula-like text gets a leading apostrophe
so spreadsheet applications treat it as text rather than executing a formula.

Read `controllers/salesCsvController.js`: `Readable.from()` turns our async
generator into a readable stream. `pipeline()` connects it to the HTTP response
and handles backpressure: when the response buffer fills, it pauses production
until the destination can accept more. Buffers and a database batch still use
memory, but the whole export isn't accumulated.

If the client disconnects, an AbortController cancels the pipeline and closes the
cursor. `finally` also closes it on success or failure. An error after downloading
has started cannot become a JSON response; the transfer ends unsuccessfully.
Do not rely on a partial download as a complete report.

Run `npm run test:csv` for isolated tests and `npm run test:sales` for real MongoDB
cursor coverage, including vendor isolation and India date boundaries.

Run `npm run test:csv` to verify the downloaded content, headers, and access guards.
The test replaces session lookup with fake accounts and does not need MongoDB.
