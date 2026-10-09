const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Order = require('../models/Order');

async function test() {
  const users = [];
  let server;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Order.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function account(role) {
      const response = await fetch(`${base}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sales test', email: `sales-${randomUUID()}@example.com`, password: 'test-password-123', role }),
      });
      assert.equal(response.status, 201);
      const { user } = await response.json(); users.push(user.id);
      return { id: user.id, cookie: response.headers.get('set-cookie').split(';')[0] };
    }
    const buyer = await account('user');
    const a = await account('vendor');
    const b = await account('vendor');
    const empty = await account('vendor');
    const p = new mongoose.Types.ObjectId();
    const q = new mongoose.Types.ObjectId();
    const address = { name: 'Test', phone: '9876543210', line1: 'Test road', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' };
    async function order(at, delivered, quantity) {
      const aTotal = quantity * 12550;
      const items = [
        { product: p, vendor: a.id, name: 'Snapshot name', quantity, unitPricePaise: 12550 },
        { product: q, vendor: b.id, name: 'Private other product', quantity: 10, unitPricePaise: 99900 },
      ];
      const vendorOrders = [
        { vendor: a.id, vendorName: 'A', subtotalPaise: aTotal, status: delivered ? 'delivered' : 'placed', paymentStatus: delivered ? 'collected' : 'pending' },
        { vendor: b.id, vendorName: 'B', subtotalPaise: 999000, status: 'placed', paymentStatus: 'pending' },
      ];
      await Order.create({ user: buyer.id, checkoutKey: randomUUID(), address, items, vendorOrders,
        totalPaise: aTotal + 999000, status: delivered ? 'partially_delivered' : 'placed',
        paymentStatus: delivered ? 'partially_collected' : 'pending', createdAt: new Date(at) });
    }
    // India midnight is 18:30 UTC on the preceding date.
    await order('2026-09-30T18:29:59.999Z', true, 1);
    await order('2026-09-30T18:30:00.000Z', true, 2);
    await order('2026-10-01T18:29:59.999Z', false, 3);
    await order('2026-10-01T18:30:00.000Z', true, 4);
    const get = (cookie, query = '') => fetch(`${base}/vendor/sales${query}`, { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal((await get()).status, 401);
    assert.equal((await get(buyer.cookie)).status, 403);
    for (const query of ['?from=2026-02-30', '?to=invalid', '?from=2026-10-02&to=2026-10-01', '?from=2026-10-01&from=2026-10-02', '?from=']) {
      assert.equal((await get(a.cookie, query)).status, 400, query);
    }
    const response = await get(a.cookie, '?from=2026-10-01&to=2026-10-01');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const report = await response.json();
    assert.deepEqual(report.summary, {
      orderCount: 2, deliveredOrderCount: 1, orderedValuePaise: 62750,
      deliveredSalesPaise: 25100, collectedCodPaise: 25100, pendingCodPaise: 37650,
    });
    assert.deepEqual(report.topProducts, [{ productId: String(p), name: 'Snapshot name', deliveredQuantity: 2, deliveredSalesPaise: 25100 }]);
    assert.equal(report.currency, 'INR');
    assert.deepEqual(report.dailySales, {
      from: '2026-10-01', to: '2026-10-01',
      days: [{ date: '2026-10-01', orderCount: 2, orderedValuePaise: 62750 }],
    });
    const daily = await (await get(a.cookie, '?from=2026-09-29&to=2026-10-03')).json();
    assert.deepEqual(daily.dailySales.days, [
      { date: '2026-09-29', orderCount: 0, orderedValuePaise: 0 },
      { date: '2026-09-30', orderCount: 1, orderedValuePaise: 12550 },
      { date: '2026-10-01', orderCount: 2, orderedValuePaise: 62750 },
      { date: '2026-10-02', orderCount: 1, orderedValuePaise: 50200 },
      { date: '2026-10-03', orderCount: 0, orderedValuePaise: 0 },
    ]);
    const wide = await (await get(a.cookie, '?from=2020-01-01&to=2026-10-03')).json();
    assert.equal(wide.summary.orderCount, 4); // Summary still covers the full range.
    assert.equal(wide.dailySales.days.length, 30);
    assert.equal(wide.dailySales.to, '2026-10-03');
    // Client-supplied vendor IDs cannot select another vendor's data.
    const injected = await (await get(a.cookie, `?from=2026-10-01&to=2026-10-01&vendorId=${b.id}`)).json();
    assert.deepEqual(injected, report);
    const bReport = await (await get(b.cookie)).json();
    assert.equal(bReport.summary.orderCount, 4);
    assert.equal(bReport.summary.orderedValuePaise, 3996000);
    assert.deepEqual(bReport.topProducts, []);
    const bDaily = await (await get(b.cookie, '?from=2026-10-01&to=2026-10-01')).json();
    assert.equal(bDaily.dailySales.days[0].orderedValuePaise, 1998000);
    const all = await (await get(a.cookie)).json();
    assert.equal(all.summary.orderedValuePaise, 125500);
    assert.equal(all.topProducts[0].deliveredQuantity, 7);
    const lower = await (await get(a.cookie, '?from=2026-10-02')).json();
    assert.equal(lower.summary.orderCount, 1);
    const upper = await (await get(a.cookie, '?to=2026-09-30')).json();
    assert.equal(upper.summary.orderCount, 1);
    const zero = await (await get(empty.cookie)).json();
    assert.ok(Object.values(zero.summary).every(value => value === 0));
    assert.deepEqual(zero.topProducts, []);
    assert.equal(zero.dailySales.days.length, 30);
    assert.ok(zero.dailySales.days.every(day => day.orderCount === 0 && day.orderedValuePaise === 0));
    const leap = await (await get(empty.cookie, '?from=2024-02-28&to=2024-03-01')).json();
    assert.deepEqual(leap.dailySales.days.map(day => day.date), ['2024-02-28', '2024-02-29', '2024-03-01']);
    const noDates = await (await get(a.cookie, '?from=2030-01-01')).json();
    assert.equal(noDates.summary.orderCount, 0);
    assert.equal(noDates.dailySales.from, '2030-01-01');
    assert.equal(noDates.dailySales.to, '2030-01-01');
    console.log('PASS: sales totals, snapshots, vendor privacy, roles, daily aggregation, zero days, bounded chart ranges, leap days and India date boundaries');
  } finally {
    if (mongoose.connection.readyState === 1 && users.length) {
      await Order.deleteMany({ user: { $in: users } });
      await User.deleteMany({ _id: { $in: users } });
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
