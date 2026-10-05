const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
const Order = require('../models/Order');
const { validateCheckout } = require('../controllers/orderController');
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
      const response = await call('/auth/register', 'POST', { name: 'Order test', email: `order-test-${new mongoose.Types.ObjectId()}@example.com`, password: 'test-password-123', role });
      assert.equal(response.status, 201);
      const { user } = await response.json();
      users.push(user.id);
      return { ...user, cookie: response.headers.get('set-cookie').split(';')[0] };
    }
    const buyer = await account('user');
    const other = await account('vendor');
    const product = await Product.create({ name: 'Order test mug', slug: `order-${buyer.id}`, description: 'Test', category: 'Test', price: 99.50, stock: 3, status: 'published', vendor: other.id });
    const second = await Product.create({ name: 'Second item', slug: `order-second-${buyer.id}`, description: 'Test', category: 'Test', price: 20, stock: 1, status: 'published', vendor: other.id });
    const row = await CartItem.create({ user: buyer.id, product: product._id, quantity: 2 });
    const row2 = await CartItem.create({ user: buyer.id, product: second._id, quantity: 1 });
    const address = { name: 'Test buyer', phone: '9876543210', line1: '12 Test Street', line2: '', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' };
    const body = { checkoutKey: require('node:crypto').randomUUID(), address, items: [
      { cartItemId: String(row._id), quantity: 2, unitPricePaise: 9950 },
      { cartItemId: String(row2._id), quantity: 1, unitPricePaise: 2000 },
    ], totalPaise: 1, user: other.id };
    assert.throws(() => validateCheckout({ ...body, address: { ...address, phone: 'bad' } }));
    assert.equal((await call('/orders')).status, 401);
    assert.equal((await call('/orders', 'POST', { ...body, address: { ...address, postalCode: 'abc' } }, buyer.cookie)).status, 400);
    await Product.updateOne({ _id: second._id }, { stock: 0 });
    const failed = await call('/orders', 'POST', body, buyer.cookie);
    assert.equal(failed.status, 409, JSON.stringify(await failed.json()));
    assert.equal((await Product.findById(product._id)).stock, 3, 'Partial stock updates must roll back');
    assert.equal(await Order.countDocuments({ user: buyer.id }), 0);
    assert.equal(await CartItem.countDocuments({ user: buyer.id }), 2);
    await Product.updateOne({ _id: second._id }, { stock: 1, price: 21 });
    assert.equal((await call('/orders', 'POST', body, buyer.cookie)).status, 409, 'Changed prices need user review');
    body.items[1].unitPricePaise = 2100;
    const responses = await Promise.all([call('/orders', 'POST', body, buyer.cookie), call('/orders', 'POST', body, buyer.cookie)]);
    const data = await Promise.all(responses.map(response => response.json()));
    responses.forEach((response, index) => assert.equal(response.status, 201, JSON.stringify(data[index])));
    assert.equal(data[0].order._id, data[1].order._id);
    assert.equal(await Order.countDocuments({ user: buyer.id }), 1);
    assert.equal((await Product.findById(product._id)).stock, 1);
    assert.equal(await CartItem.countDocuments({ user: buyer.id }), 0);
    const history = await (await call('/orders', 'GET', undefined, buyer.cookie)).json();
    assert.equal(history.orders[0].totalPaise, 22000);
    assert.equal(history.orders[0].deliveryFeePaise, 0);
    assert.equal(history.orders[0].paymentStatus, 'pending');
    assert.equal(history.orders[0].checkoutKey, undefined);
    assert.equal((await (await call('/orders', 'GET', undefined, other.cookie)).json()).orders.length, 0);
    const orderId = data[0].order._id;
    const changedAddress = { ...address, name: '  Updated buyer  ', line1: '  45 New Street  ', line2: 'Near the library', city: 'Madurai', postalCode: '625001' };
    const editPath = `/orders/${orderId}/address`;
    assert.equal((await call(editPath, 'PATCH', { address: changedAddress })).status, 401);
    assert.equal((await call('/orders/bad/address', 'PATCH', { address: changedAddress }, buyer.cookie)).status, 400);
    assert.equal((await call(editPath, 'PATCH', { address: changedAddress }, other.cookie)).status, 404);
    assert.equal((await call(`/orders/${new mongoose.Types.ObjectId()}/address`, 'PATCH', { address: changedAddress }, buyer.cookie)).status, 404);
    for (const invalidAddress of [
      { ...address, phone: '123' }, { ...address, postalCode: 'bad' },
      { ...address, city: '' }, { ...address, line1: 'x'.repeat(201) },
    ]) {
      assert.equal((await call(editPath, 'PATCH', { address: invalidAddress }, buyer.cookie)).status, 400);
    }
    assert.equal((await call(editPath, 'PATCH', {}, buyer.cookie)).status, 400);
    assert.equal((await Order.findById(orderId)).address.line1, address.line1, 'Failed edits preserve the address');
    const edited = await call(editPath, 'PATCH', { address: changedAddress, status: 'shipped', totalPaise: 1, user: other.id }, buyer.cookie);
    assert.equal(edited.status, 200);
    const editedBody = await edited.json();
    assert.equal(editedBody.order.address.name, 'Updated buyer');
    assert.equal(editedBody.order.address.line1, '45 New Street');
    assert.equal(editedBody.order.user, undefined);
    assert.equal(editedBody.order.checkoutKey, undefined);
    assert.equal(editedBody.order.totalPaise, 22000);
    assert.equal(editedBody.order.status, 'placed');
    assert.equal((await Product.findById(product._id)).stock, 1);
    assert.equal(await CartItem.countDocuments({ user: buyer.id }), 0);
    const updatedHistory = await (await call('/orders', 'GET', undefined, buyer.cookie)).json();
    assert.equal(updatedHistory.orders[0].address.city, 'Madurai');
    // Simulate a future fulfilment status without expanding this feature's schema.
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $set: { status: 'shipped' } });
    assert.equal((await call(editPath, 'PATCH', { address }, buyer.cookie)).status, 409);
    assert.equal((await Order.findById(orderId)).address.city, 'Madurai', 'Non-placed orders reject address changes');
    assert.equal((await call(editPath, 'PATCH', { address }, other.cookie)).status, 404);
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $set: { status: 'placed' } });
    console.log('PASS: address edits, ownership, invalid input, persistence, locked status and unchanged stock/totals');

    await Product.updateOne({ _id: product._id }, { name: 'Renamed', price: 1 });
    const saved = await Order.findById(data[0].order._id);
    assert.equal(saved.items[0].name, 'Order test mug');
    assert.equal(saved.items[0].unitPricePaise, 9950);
    assert.equal((await call('/orders', 'POST', body, buyer.cookie)).status, 201, 'Lost-response retry works even with an empty cart');
    const newRow = await CartItem.create({ user: other.id, product: product._id, quantity: 1 });
    const lastBody = { checkoutKey: require('node:crypto').randomUUID(), address, items: [{ cartItemId: String(newRow._id), quantity: 1, unitPricePaise: 100 }] };
    const race = await Promise.all([call('/orders', 'POST', lastBody, other.cookie), call('/orders', 'POST', { ...lastBody, checkoutKey: require('node:crypto').randomUUID() }, other.cookie)]);
    assert.equal(race.filter(response => response.status === 201).length, 1);
    assert.equal(race.filter(response => response.status === 409).length, 1);
    assert.equal((await Product.findById(product._id)).stock, 0);
    console.log('PASS: address validation, authentication, rollback, price review, duplicate retries, ownership, snapshots, free COD and competing checkout');
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
