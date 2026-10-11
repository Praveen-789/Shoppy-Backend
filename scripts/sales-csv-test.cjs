const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const express = require('express');
const cookieParser = require('cookie-parser');
const authService = require('../services/authService');
const csvService = require('../services/salesCsvService');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function test() {
  const original = authService.getUserFromToken;
  const originalCursor = csvService.createCursor;
  let closed = 0;
  let seenDates;
  let mode = 'normal';
  csvService.createCursor = (vendorId, start, end) => {
    assert.equal(vendorId, 'test-vendor');
    seenDates = [start, end];
    let read = false;
    return {
      async next() {
        if (mode === 'failure') throw new Error('Simulated database failure');
        if (read || mode === 'empty') return null;
        read = true;
        return {
          _id: 'order-1', createdAt: new Date('2026-10-01T00:00:00Z'),
          vendorOrders: [{ vendor: 'test-vendor', status: 'packed', paymentStatus: 'pending' }],
          items: [
            { vendor: 'other', name: 'PRIVATE OTHER ITEM', quantity: 1, unitPricePaise: 1 },
            { vendor: 'test-vendor', name: 'Shirt, "blue"\nlarge', quantity: 2, unitPricePaise: 12550 },
            { vendor: 'test-vendor', name: '=SUM(A1:A2)', quantity: 1, unitPricePaise: 100 },
          ],
        };
      },
      async *[Symbol.asyncIterator]() {},
      async close() { closed++; },
    };
  };
  // Keep the real vendor router and guards; replace only database-backed lookup.
  authService.getUserFromToken = async token => {
    if (token === 'vendor-session') return { id: 'test-vendor', role: 'vendor' };
    if (token === 'buyer-session') return { id: 'test-buyer', role: 'user' };
    return null;
  };
  const app = express();
  app.use(cookieParser());
  app.use('/api/vendor', require('../routes/vendor'));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(500).json({ message: 'Export failed.' });
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/vendor/sales/demo.csv`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: 'authToken=buyer-session' } })).status, 403);
    const response = await fetch(url, { headers: { Cookie: 'authToken=vendor-session' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="shoppy-demo-sales.csv"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'Product,Quantity,Unit price INR\r\nBlue shirt,2,499.00\r\nRunning shoes,1,1499.00\r\nCoffee mug,3,249.00\r\n');
    const exportUrl = url.replace('demo.csv', 'export.csv');
    const headers = { Cookie: 'authToken=vendor-session' };
    assert.equal((await fetch(exportUrl)).status, 401);
    assert.equal((await fetch(exportUrl, { headers: { Cookie: 'authToken=buyer-session' } })).status, 403);
    for (const query of ['?from=2026-02-30', '?from=x', '?from=2026-10-02&to=2026-10-01', '?from=a&from=b']) {
      assert.equal((await fetch(exportUrl + query, { headers })).status, 400);
    }
    const real = await fetch(exportUrl + '?from=2026-10-01&to=2026-10-01', { headers });
    const text = await real.text();
    assert.equal(real.status, 200);
    assert.equal(real.headers.get('content-disposition'), 'attachment; filename="shoppy-sales.csv"');
    assert.equal(seenDates[0].toISOString(), '2026-09-30T18:30:00.000Z');
    assert.equal(seenDates[1].toISOString(), '2026-10-01T18:30:00.000Z');
    assert.doesNotMatch(text, /PRIVATE OTHER ITEM/);
    assert.match(text, /"Shirt, ""blue""\nlarge"/);
    assert.match(text, /"125.50","251.00","packed","pending"/);
    assert.ok(text.includes('"\'=SUM(A1:A2)"'));
    assert.equal(closed, 1);
    mode = 'empty';
    const empty = await (await fetch(exportUrl, { headers })).text();
    assert.equal(empty.split('\r\n').length, 2, 'Empty export has a header only.');
    mode = 'failure';
    const failed = await fetch(exportUrl, { headers });
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get('content-disposition'), null);
    assert.equal(closed, 3);

    // Disconnect while the first database read is pending: close must unblock it.
    let releaseRead;
    let cancelCloses = 0;
    csvService.createCursor = () => ({
      next: () => new Promise(resolve => { releaseRead = resolve; }),
      close: async () => { cancelCloses++; releaseRead(null); },
    });
    const disconnected = new EventEmitter();
    disconnected.writableFinished = false;
    const pending = require('../controllers/salesCsvController').downloadSales(
      { query: {}, user: { id: 'test-vendor' } }, disconnected,
      error => { throw error; },
    );
    disconnected.emit('close');
    await pending;
    assert.equal(cancelCloses, 1, 'Disconnect cleanup must close the cursor exactly once.');

    // A slow writable must not cause the generator to produce every row at once.
    let produced = 0;
    let consumed = 0;
    async function* manyRows() {
      for (let i = 0; i < 200; i++) { produced++; yield 'x'.repeat(1024); }
    }
    await pipeline(Readable.from(manyRows(), { objectMode: false, highWaterMark: 1024 }), new Writable({
      highWaterMark: 1024,
      write(chunk, encoding, callback) {
        consumed++;
        assert.ok(produced - consumed < 10, 'Producer should stay bounded behind a slow consumer.');
        setImmediate(callback);
      },
    }));
    assert.equal(consumed, 200);
    console.log('CSV tests passed: headers, permissions, vendor isolation, dates, escaping, empty exports, failures, cancellation and backpressure.');
  } finally {
    authService.getUserFromToken = original;
    csvService.createCursor = originalCursor;
    await new Promise(resolve => server.close(resolve));
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
