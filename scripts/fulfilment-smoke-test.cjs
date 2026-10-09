const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
const Order = require('../models/Order');
const { migrateVendorOrders } = require('../services/orderMigration');
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
    async function account(role, name) {
      const response = await call('/auth/register', 'POST', { name, email: `fulfilment-${randomUUID()}@example.com`, password: 'test-password-123', role });
      assert.equal(response.status, 201);
      const { user } = await response.json(); users.push(user.id);
      return { ...user, cookie: response.headers.get('set-cookie').split(';')[0] };
    }
    const buyer = await account('user', 'Buyer');
    const a = await account('vendor', 'Seller A');
    const b = await account('vendor', 'Seller B');
    const outsider = await account('vendor', 'Unrelated seller');
    const address = { name: 'Buyer', phone: '9876543210', line1: '12 Example Road', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' };
    const products = [];
    for (const [vendor, price, name] of [[a, 1000, 'Shoes'], [b, 1500, 'Backpack'], [a, 100, 'Socks']]) {
      products.push(await Product.create({ vendor: vendor.id, name, price, stock: 5, status: 'published', slug: randomUUID(), category: 'Test', description: 'Fulfilment test' }));
    }
    const cart = await CartItem.create(products.map(product => ({ user: buyer.id, product: product._id, quantity: 1 })));
    const placed = await call('/orders', 'POST', { address, checkoutKey: randomUUID(), items: cart.map((row, index) => ({
      cartItemId: String(row._id), quantity: 1, unitPricePaise: products[index].price * 100,
    })) }, buyer.cookie);
    assert.equal(placed.status, 201);
    const id = (await placed.json()).order._id;
    const path = `/vendor/orders/${id}/status`;
    const change = (vendor, expectedStatus, status, extra = {}) => call(path, 'PATCH', { expectedStatus, status, ...extra }, vendor.cookie);
    const list = async vendor => (await (await call('/vendor/orders', 'GET', undefined, vendor.cookie)).json()).orders;
    assert.equal((await call('/vendor/orders')).status, 401);
    assert.equal((await call('/vendor/orders', 'GET', undefined, buyer.cookie)).status, 403);
    assert.equal((await call(path, 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, buyer.cookie)).status, 403);
    assert.equal((await change(outsider, 'placed', 'confirmed')).status, 404);
    assert.equal((await list(outsider)).length, 0);
    const aOrder = (await list(a)).find(order => order._id === id);
    assert.equal(aOrder.items.length, 2);
    assert.equal(aOrder.subtotalPaise, 110000);
    assert.ok(aOrder.items.every(item => String(item.vendor) === a.id));
    for (const field of ['user', 'checkoutKey', 'vendorOrders', 'totalPaise', 'fulfilmentVersion']) assert.equal(aOrder[field], undefined);
    assert.equal((await list(b))[0].subtotalPaise, 150000);
    const saved = await Order.findById(id).lean();
    assert.equal(saved.vendorOrders.length, 2);
    assert.equal(saved.vendorOrders[0].vendorName, 'Seller A');
    assert.equal(saved.totalPaise, 260000);
    assert.equal((await call('/vendor/orders/bad/status', 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, a.cookie)).status, 400);
    assert.equal((await call('/vendor/orders?page=0', 'GET', undefined, a.cookie)).status, 400);
    assert.equal((await change(a, 'placed', 'nonsense')).status, 400);
    assert.equal((await change(a, 'placed', 'delivered', { cashCollected: true })).status, 409);
    assert.equal((await change(a, 'placed', 'confirmed', { cashCollected: true })).status, 400);
    const duplicate = await Promise.all([change(a, 'placed', 'confirmed', { vendor: b.id }), change(a, 'placed', 'confirmed')]);
    assert.equal(duplicate.filter(response => response.status === 200).length, 1);
    assert.equal(duplicate.filter(response => response.status === 409).length, 1);
    let order = await Order.findById(id).lean();
    assert.equal(order.vendorOrders.find(portion => String(portion.vendor) === b.id).status, 'placed');
    assert.equal(order.vendorOrders.find(portion => String(portion.vendor) === a.id).history.length, 2);
    assert.equal(order.status, 'processing');
    assert.equal((await call(`/orders/${id}/address`, 'PATCH', { address: { ...address, city: 'Madurai' } }, buyer.cookie)).status, 409);
    assert.equal((await change(a, 'placed', 'confirmed')).status, 409);
    for (const [from, to] of [['confirmed', 'packed'], ['packed', 'shipped'], ['shipped', 'out_for_delivery']]) {
      assert.equal((await change(a, from, to)).status, 200);
    }
    assert.equal((await change(a, 'out_for_delivery', 'delivered')).status, 400);
    assert.equal((await change(a, 'out_for_delivery', 'delivered', { cashCollected: true })).status, 200);
    order = await Order.findById(id).lean();
    assert.equal(order.status, 'partially_delivered');
    assert.equal(order.paymentStatus, 'partially_collected');
    assert.equal(order.vendorOrders.find(portion => String(portion.vendor) === b.id).paymentStatus, 'pending');
    assert.equal((await change(a, 'delivered', 'confirmed')).status, 409);
    for (const [from, to] of [['placed', 'confirmed'], ['confirmed', 'packed'], ['packed', 'shipped'], ['shipped', 'out_for_delivery'], ['out_for_delivery', 'delivered']]) {
      assert.equal((await change(b, from, to, { cashCollected: to === 'delivered' })).status, 200);
    }
    order = await Order.findById(id).lean();
    assert.equal(order.status, 'delivered');
    assert.equal(order.paymentStatus, 'collected');
    assert.equal(order.totalPaise, 260000);
    assert.deepEqual(order.items, saved.items);
    for (const product of products) assert.equal((await Product.findById(product._id)).stock, 4);
    const customer = (await (await call('/orders', 'GET', undefined, buyer.cookie)).json()).orders.find(order => order._id === id);
    assert.equal(customer.vendorOrders.length, 2);
    assert.ok(customer.vendorOrders.every(portion => portion.history.length === 6));
    assert.equal(customer.fulfilmentVersion, undefined);
    // Old orders gain portions based on their purchased snapshots, not new prices.
    const legacy = await Order.create({ user: buyer.id, checkoutKey: randomUUID(), address, items: saved.items, totalPaise: 260000 });
    await Product.updateMany({ vendor: { $in: [a.id, b.id] } }, { price: 1 });
    assert.equal(await migrateVendorOrders({ _id: legacy._id }), 1);
    assert.equal(await migrateVendorOrders({ _id: legacy._id }), 0);
    const migrated = await Order.findById(legacy._id).lean();
    assert.equal(migrated.vendorOrders.reduce((sum, portion) => sum + portion.subtotalPaise, 0), 260000);
    assert.equal(migrated.vendorOrders.length, 2);
    const legacyPath = `/vendor/orders/${legacy._id}/status`;
    const concurrent = await Promise.all([a, b].map(vendor => call(legacyPath, 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, vendor.cookie)));
    for (let index = 0; index < concurrent.length; index++) {
      assert.ok([200, 409].includes(concurrent[index].status));
      if (concurrent[index].status === 409) assert.equal((await call(legacyPath, 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, [a, b][index].cookie)).status, 200);
    }
    assert.equal((await Order.findById(legacy._id)).status, 'confirmed', 'Concurrent vendor changes keep overall status correct');
    // Address edits racing confirmation are accepted only if they happen first.
    const raceOrder = await Order.create({ user: buyer.id, checkoutKey: randomUUID(), address, items: saved.items, totalPaise: 260000,
      vendorOrders: migrated.vendorOrders });
    const race = await Promise.all([
      call(`/orders/${raceOrder._id}/address`, 'PATCH', { address: { ...address, line1: 'New road' } }, buyer.cookie),
      call(`/vendor/orders/${raceOrder._id}/status`, 'PATCH', { expectedStatus: 'placed', status: 'confirmed' }, a.cookie),
    ]);
    assert.ok([200, 409].includes(race[0].status));
    assert.equal(race[1].status, 200);
    assert.equal((await call(`/orders/${raceOrder._id}/address`, 'PATCH', { address }, buyer.cookie)).status, 409);
    console.log('PASS: multi-vendor grouping, privacy, permissions, sequential transitions, stale/concurrent writes, COD collection, address lock, stock preservation and idempotent migration');
  } finally {
    if (mongoose.connection.readyState === 1) {
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
