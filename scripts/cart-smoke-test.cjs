const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
async function test() {
  let server;
  const users = [];
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Product.init(), CartItem.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = (path, method = 'GET', body, cookie) => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    async function account(role) {
      const email = `cart-test-${new mongoose.Types.ObjectId()}@example.com`;
      const res = await call('/auth/register', 'POST', { name: role, email, password: 'test-password-123', role });
      assert.equal(res.status, 201);
      const { user } = await res.json();
      users.push(user.id);
      return { ...user, email, cookie: res.headers.get('set-cookie').split(';')[0] };
    }
    const a = await account('user');
    const b = await account('vendor');
    const product = await Product.create({ name: 'Cart test mug', slug: `cart-${a.id}`, description: 'Test', category: 'Test', price: 99, stock: 2, status: 'published', vendor: b.id });
    const body = { productId: String(product._id), user: b.id, price: 1 };
    assert.equal((await call('/cart')).status, 401);
    assert.equal((await call('/cart/items', 'POST', { productId: 'bad' }, a.cookie)).status, 400);
    const first = await call('/cart/items', 'POST', body, a.cookie);
    assert.equal(first.status, 200);
    const saved = await first.json();
    const id = saved.items[0].cartItemId;
    assert.equal(saved.userId, a.id);
    assert.equal(saved.items[0].price, 99);
    assert.equal(saved.items[0].vendor.email, undefined);
    assert.equal((await (await call('/cart', 'GET', undefined, b.cookie)).json()).items.length, 0);
    assert.equal((await call(`/cart/items/${id}`, 'PATCH', { quantity: 1 }, b.cookie)).status, 404);
    await call(`/cart/items/${id}`, 'DELETE', undefined, b.cookie);
    assert.equal((await CartItem.findById(id)).quantity, 1);
    assert.equal((await call(`/cart/items/${id}`, 'PATCH', { quantity: 1.5 }, a.cookie)).status, 400);
    assert.equal((await call(`/cart/items/${id}`, 'PATCH', { quantity: 3 }, a.cookie)).status, 409);
    const results = await Promise.all(Array.from({ length: 4 }, () => call('/cart/items', 'POST', body, a.cookie)));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal((await CartItem.findById(id)).quantity, 2);
    const login = await call('/auth/login', 'POST', { email: a.email, password: 'test-password-123' });
    assert.equal(login.status, 200);
    const secondDevice = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/cart', 'GET', undefined, secondDevice)).json()).items[0].quantity, 2);
    await Product.updateOne({ _id: product._id }, { price: 120, stock: 1 });
    const refreshed = await (await call('/cart', 'GET', undefined, a.cookie)).json();
    assert.equal(refreshed.items[0].price, 120);
    assert.equal(refreshed.items[0].stock, 1);
    assert.equal((await call(`/cart/items/${id}`, 'PATCH', { quantity: 1 }, a.cookie)).status, 200);
    await call('/cart/items', 'POST', body, b.cookie);
    await call('/cart', 'DELETE', undefined, a.cookie);
    assert.equal((await (await call('/cart', 'GET', undefined, b.cookie)).json()).items.length, 1);
    await Product.updateOne({ _id: product._id }, { status: 'draft' });
    const hidden = await (await call('/cart', 'GET', undefined, b.cookie)).json();
    assert.equal(hidden.items[0].name, 'Unavailable product');
    assert.equal(hidden.items[0].stock, 0);
    assert.equal((await call('/cart/items', 'POST', body, a.cookie)).status, 404);
    await Product.deleteOne({ _id: product._id });
    assert.equal((await call(`/cart/items/${hidden.items[0].cartItemId}`, 'DELETE', undefined, b.cookie)).status, 200);
    console.log('PASS: authentication, ownership, validation, stock concurrency, second-session persistence, current prices, unavailable products, remove and clear');
  } finally {
    if (mongoose.connection.readyState === 1) {
      await CartItem.deleteMany({ user: { $in: users } });
      await Product.deleteMany({ vendor: { $in: users } });
      await User.deleteMany({ _id: { $in: users } });
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
