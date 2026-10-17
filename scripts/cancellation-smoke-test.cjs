const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
const Order = require('../models/Order');

async function test() {
  const users = [];
  let server;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Product.init(), CartItem.init(), Order.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = (path, method = 'GET', body, cookie) => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    async function account(role) {
      const response = await call('/auth/register', 'POST', {
        name: 'Cancellation test', email: `cancel-${randomUUID()}@example.com`, password: 'test-password-123', role,
      });
      assert.equal(response.status, 201);
      const { user } = await response.json(); users.push(user.id);
      return { ...user, cookie: response.headers.get('set-cookie').split(';')[0] };
    }
    const buyer = await account('user');
    const a = await account('vendor');
    const b = await account('vendor');
    const address = { name: 'Buyer', phone: '9876543210', line1: 'Test road', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' };
    async function checkout() {
      const products = [];
      for (const vendor of [a, b]) products.push(await Product.create({ vendor: vendor.id,
        name: 'Cancellation mug', slug: randomUUID(), description: 'Test', category: 'Test', price: 100, stock: 5, status: 'published' }));
      const rows = await CartItem.create(products.map(product => ({ user: buyer.id, product: product._id, quantity: 2 })));
      const body = { checkoutKey: randomUUID(), address, items: rows.map(row => ({ cartItemId: String(row._id), quantity: 2, unitPricePaise: 10000 })) };
      const response = await call('/orders', 'POST', body, buyer.cookie);
      assert.equal(response.status, 201);
      return { id: (await response.json()).order._id, products, body };
    }
    const cancel = (id, cookie = buyer.cookie) => call(`/orders/${id}/cancel`, 'PATCH', {}, cookie);
    const confirm = id => call(`/vendor/orders/${id}/status`, 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, a.cookie);
    const first = await checkout();
    const before = await Order.findById(first.id).lean();
    assert.equal((await call(`/orders/${first.id}/cancel`, 'PATCH')).status, 401);
    assert.equal((await cancel('bad')).status, 400);
    assert.equal((await cancel(new mongoose.Types.ObjectId())).status, 404);
    assert.equal((await cancel(first.id, a.cookie)).status, 404);
    await Product.updateOne({ _id: first.products[0]._id }, { status: 'draft' });
    const responses = await Promise.all([cancel(first.id), cancel(first.id)]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      const { order } = await response.json();
      assert.equal(order.status, 'cancelled');
      assert.equal(order.paymentStatus, 'not_required');
      assert.ok(order.cancelledAt);
      for (const field of ['user', 'checkoutKey', 'fulfilmentVersion']) assert.equal(order[field], undefined);
    }
    const saved = await Order.findById(first.id).lean();
    assert.deepEqual(saved.items.map(({ status, cancelledAt, ...item }) => item), before.items.map(({ status, cancelledAt, ...item }) => item));
    assert.ok(saved.items.every(item => item.status === 'cancelled' && item.cancelledAt));
    assert.equal(saved.payablePaise, 0);
    assert.equal(saved.totalPaise, before.totalPaise);
    assert.equal(saved.fulfilmentVersion, 1);
    assert.ok(saved.vendorOrders.every(part => part.status === 'cancelled' && part.paymentStatus === 'not_required' && part.history.length === 2));
    assert.equal((await cancel(first.id)).status, 200);
    for (const product of first.products) assert.equal((await Product.findById(product._id)).stock, 5);
    assert.equal(await CartItem.countDocuments({ user: buyer.id }), 0);
    assert.equal((await confirm(first.id)).status, 409);
    assert.equal((await call(`/orders/${first.id}/address`, 'PATCH', { address }, buyer.cookie)).status, 409);
    const retry = await call('/orders', 'POST', first.body, buyer.cookie);
    assert.equal((await retry.json()).order._id, first.id);
    const history = await (await call('/orders', 'GET', undefined, buyer.cookie)).json();
    assert.equal(history.orders[0].status, 'cancelled');
    for (const vendor of [a, b]) {
      const incoming = await (await call('/vendor/orders', 'GET', undefined, vendor.cookie)).json();
      assert.equal(incoming.orders[0].status, 'cancelled');
      const sales = await (await call('/vendor/sales', 'GET', undefined, vendor.cookie)).json();
      assert.ok(Object.values(sales.summary).every(value => value === 0));
      assert.ok(sales.dailySales.days.every(day => day.orderCount === 0 && day.orderedValuePaise === 0));
      assert.deepEqual(sales.topProducts, []);
      const csv = await (await call('/vendor/sales/export.csv', 'GET', undefined, vendor.cookie)).text();
      assert.equal(csv.split('\r\n').length, 2);
      const excel = await call('/vendor/sales/export.xlsx', 'GET', undefined, vendor.cookie);
      const workbook = new (require('exceljs').Workbook)();
      await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()));
      assert.equal(workbook.getWorksheet('Sales').rowCount, 1);
    }
    const locked = await checkout();
    assert.equal((await confirm(locked.id)).status, 200);
    assert.equal((await cancel(locked.id)).status, 409);
    for (const product of locked.products) assert.equal((await Product.findById(product._id)).stock, 3);
    // A missing second product forces rollback after the first stock write.
    const broken = await checkout();
    await Product.deleteOne({ _id: broken.products[1]._id });
    assert.equal((await cancel(broken.id)).status, 409);
    assert.equal((await Product.findById(broken.products[0]._id)).stock, 3);
    const rolledBack = await Order.findById(broken.id).lean();
    assert.equal(rolledBack.status, 'placed');
    assert.equal(rolledBack.cancelledAt, undefined);
    assert.equal(rolledBack.fulfilmentVersion, 0);
    assert.ok(rolledBack.vendorOrders.every(part => part.history.length === 1));
    for (let index = 0; index < 3; index++) {
      const race = await checkout();
      const results = await Promise.all([cancel(race.id), confirm(race.id)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      const final = await Order.findById(race.id).lean();
      const cancelled = final.status === 'cancelled';
      for (const product of race.products) assert.equal((await Product.findById(product._id)).stock, cancelled ? 5 : 3);
      assert.equal(final.paymentStatus, cancelled ? 'not_required' : 'pending');
    }
    // Cancel one line while the other line from the same seller remains active.
    const partial = await checkout();
    const extra = await Product.create({ vendor: a.id, name: 'Extra mug', slug: randomUUID(), description: 'Test', category: 'Test', price: 50, stock: 3, status: 'published' });
    await Order.updateOne({ _id: partial.id }, {
      $push: { items: { product: extra._id, vendor: a.id, name: extra.name, quantity: 2, unitPricePaise: 5000 } },
      $inc: { totalPaise: 10000, payablePaise: 10000, 'vendorOrders.0.subtotalPaise': 10000, 'vendorOrders.0.payablePaise': 10000 },
    });
    const cancelItem = (order, product, cookie = buyer.cookie) => call(`/orders/${order}/items/${product}/cancel`, 'PATCH', {}, cookie);
    assert.equal((await call(`/orders/${partial.id}/items/${extra._id}/cancel`, 'PATCH')).status, 401);
    assert.equal((await cancelItem(partial.id, 'bad')).status, 400);
    assert.equal((await cancelItem(partial.id, new mongoose.Types.ObjectId())).status, 404);
    assert.equal((await cancelItem(partial.id, extra._id, a.cookie)).status, 404);
    const duplicateItems = await Promise.all([cancelItem(partial.id, extra._id), cancelItem(partial.id, extra._id)]);
    assert.ok(duplicateItems.every(response => response.status === 200));
    let partialSaved = await Order.findById(partial.id).lean();
    assert.equal(partialSaved.totalPaise, 50000);
    assert.equal(partialSaved.payablePaise, 40000);
    assert.equal(partialSaved.vendorOrders[0].subtotalPaise, 30000);
    assert.equal(partialSaved.vendorOrders[0].payablePaise, 20000);
    assert.equal(partialSaved.vendorOrders[0].status, 'placed');
    assert.equal((await Product.findById(extra._id)).stock, 5);
    assert.equal((await Product.findById(partial.products[0]._id)).stock, 3);
    assert.equal((await confirm(partial.id)).status, 200);
    assert.equal((await cancelItem(partial.id, partial.products[0]._id)).status, 409);
    // Seller B can still be cancelled after A confirms.
    assert.equal((await cancelItem(partial.id, partial.products[1]._id)).status, 200);
    partialSaved = await Order.findById(partial.id).lean();
    assert.equal(partialSaved.status, 'confirmed');
    assert.equal(partialSaved.payablePaise, 20000);
    for (const [from, to] of [['confirmed', 'packed'], ['packed', 'shipped'], ['shipped', 'out_for_delivery'], ['out_for_delivery', 'delivered']]) {
      assert.equal((await call(`/vendor/orders/${partial.id}/status`, 'PATCH', { expectedStatus: from, status: to, cashCollected: to === 'delivered' }, a.cookie)).status, 200);
    }
    partialSaved = await Order.findById(partial.id).lean();
    assert.equal(partialSaved.status, 'delivered');
    assert.equal(partialSaved.paymentStatus, 'collected');
    const report = await (await call('/vendor/sales', 'GET', undefined, a.cookie)).json();
    assert.equal(report.summary.deliveredSalesPaise, 20000);
    assert.equal(report.summary.collectedCodPaise, 20000);
    assert.ok(!report.topProducts.some(product => product.productId === String(extra._id)));
    assert.equal(report.topProducts.find(product => product.productId === String(partial.products[0]._id)).deliveredQuantity, 2);
    const exported = await (await call('/vendor/sales/export.csv', 'GET', undefined, a.cookie)).text();
    assert.ok(!exported.includes('Extra mug'));
    const workbookResponse = await call('/vendor/sales/export.xlsx', 'GET', undefined, a.cookie);
    const partialWorkbook = new (require('exceljs').Workbook)();
    await partialWorkbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
    partialWorkbook.getWorksheet('Sales').eachRow(row => assert.notEqual(row.getCell(3).value, 'Extra mug'));
    // Item then whole-order cancellation returns each quantity exactly once.
    const remainder = await checkout();
    assert.equal((await cancelItem(remainder.id, remainder.products[0]._id)).status, 200);
    assert.equal((await call(`/orders/${remainder.id}/address`, 'PATCH', { address }, buyer.cookie)).status, 200);
    assert.equal((await cancel(remainder.id)).status, 200);
    for (const product of remainder.products) assert.equal((await Product.findById(product._id)).stock, 5);
    const allItems = await checkout();
    const itemRace = await Promise.all(allItems.products.map(product => cancelItem(allItems.id, product._id)));
    assert.ok(itemRace.every(response => response.status === 200));
    assert.equal((await Order.findById(allItems.id)).status, 'cancelled');
    assert.equal((await Order.findById(allItems.id)).payablePaise, 0);
    const mixed = await checkout();
    const mixedRace = await Promise.all([cancel(mixed.id), cancelItem(mixed.id, mixed.products[0]._id)]);
    assert.ok(mixedRace.every(response => response.status === 200));
    for (const product of mixed.products) assert.equal((await Product.findById(product._id)).stock, 5);
    const itemConfirm = await checkout();
    const itemConfirmRace = await Promise.all([cancelItem(itemConfirm.id, itemConfirm.products[0]._id), confirm(itemConfirm.id)]);
    assert.deepEqual(itemConfirmRace.map(response => response.status).sort(), [200, 409]);
    // Item cancellation also rolls back when its stock record is missing.
    assert.equal((await cancelItem(broken.id, broken.products[1]._id)).status, 409);
    assert.equal((await Order.findById(broken.id)).items[1].status, 'active');
    const legacy = await checkout();
    await Order.updateOne({ _id: legacy.id }, { $set: { vendorOrders: [] } });
    assert.equal((await cancel(legacy.id)).status, 200);
    const legacySaved = await Order.findById(legacy.id).lean();
    assert.equal(legacySaved.vendorOrders.length, 2);
    assert.ok(legacySaved.vendorOrders.every(part => part.status === 'cancelled'));
    assert.equal(await require('../services/orderMigration').migrateVendorOrders({ _id: legacySaved._id }), 0);
    for (const product of legacy.products) assert.equal((await Product.findById(product._id)).stock, 5);
    console.log('PASS: cancellation permissions, retries, multi-vendor stock restoration, rollback, confirmation races, legacy orders, history, sales and exports');
  } finally {
    if (mongoose.connection.readyState === 1 && users.length) {
      await Order.deleteMany({ user: { $in: users } });
      await CartItem.deleteMany({ user: { $in: users } });
      await Product.deleteMany({ vendor: { $in: users } });
      await User.deleteMany({ _id: { $in: users } });
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
