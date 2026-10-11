const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const WishlistItem = require('../models/WishlistItem');
async function test() {
  let server;
  const users = [];
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Product.init(), WishlistItem.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = (path, method = 'GET', body, cookie) => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    async function account(role) {
      const email = `wishlist-test-${new mongoose.Types.ObjectId()}@example.com`;
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
    assert.equal((await call('/wishlist')).status, 401);
    assert.equal((await call('/wishlist/items', 'POST', { productId: 'bad' }, a.cookie)).status, 400);
    const results = await Promise.all(Array.from({ length: 4 }, () => call('/wishlist/items', 'POST', body, a.cookie)));
    assert.ok(results.every(result => result.status === 200));
    const saved = await (await call('/wishlist', 'GET', undefined, a.cookie)).json();
    assert.equal(saved.userId, a.id);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].price, 99);
    assert.equal(saved.items[0].vendor.email, undefined);
    const id = saved.items[0].wishlistItemId;
    assert.equal((await (await call('/wishlist', 'GET', undefined, b.cookie)).json()).items.length, 0);
    await call(`/wishlist/items/${id}`, 'DELETE', undefined, b.cookie);
    assert.ok(await WishlistItem.findById(id));
    const login = await call('/auth/login', 'POST', { email: a.email, password: 'test-password-123' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/wishlist', 'GET', undefined, cookie)).json()).items.length, 1);
    await Product.updateOne({ _id: product._id }, { stock: 0, price: 120 });
    assert.equal((await call('/wishlist/items', 'POST', body, b.cookie)).status, 200);
    const refreshed = await (await call('/wishlist', 'GET', undefined, a.cookie)).json();
    assert.equal(refreshed.items[0].price, 120);
    assert.equal(refreshed.items[0].stock, 0);
    assert.equal(refreshed.items[0].available, true);
    await Product.updateOne({ _id: product._id }, { status: 'draft' });
    const hidden = await (await call('/wishlist', 'GET', undefined, a.cookie)).json();
    assert.equal(hidden.items[0].name, 'Unavailable product');
    assert.equal(hidden.items[0].available, false);
    assert.equal((await call('/wishlist/items', 'POST', body, a.cookie)).status, 404);
    await Product.deleteOne({ _id: product._id });
    assert.equal((await call(`/wishlist/items/${id}`, 'DELETE', undefined, a.cookie)).status, 200);
    assert.equal((await call(`/wishlist/items/${id}`, 'DELETE', undefined, a.cookie)).status, 200);
    assert.equal((await (await call('/wishlist', 'GET', undefined, b.cookie)).json()).items.length, 1);
    console.log('PASS: wishlist authentication, account isolation, duplicate saves, persistence, live prices, sold-out saves and unavailable removal');
  } finally {
    if (mongoose.connection.readyState === 1) {
      await WishlistItem.deleteMany({ user: { $in: users } });
      await Product.deleteMany({ vendor: { $in: users } });
      await User.deleteMany({ _id: { $in: users } });
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error); process.exitCode = 1; });
