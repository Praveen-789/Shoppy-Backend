const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const cloud = require('../services/cloudinaryService');

async function test() {
  let server;
  const users = [];
  const emails = [];
  const originalUpload = cloud.uploadProductImage;
  const originalDelete = cloud.deleteProductImage;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Product.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = (path, method = 'GET', body, cookie, headers = {}) => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    async function account(role) {
      const email = `vendor-test-${new mongoose.Types.ObjectId()}@example.com`;
      emails.push(email);
      const res = await call('/auth/register', 'POST', { name: role, email, password: 'test-password-123', role });
      assert.equal(res.status, 201);
      const { user } = await res.json();
      users.push(user.id);
      assert.equal(user.role, role);
      return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
    }
    const vendor = await account('vendor');
    const other = await account('vendor');
    const shopper = await account('user');
    assert.equal((await call('/auth/register', 'POST', { role: 'admin' })).status, 400);
    const details = { name: 'Test item', description: 'A vendor product', category: `Test-${vendor.id}`, price: 99.5, stock: 5, status: 'draft' };
    assert.equal((await call('/vendor/products', 'POST', details)).status, 401);
    assert.equal((await call('/vendor/products', 'POST', details, shopper.cookie)).status, 403);
    assert.equal((await call('/vendor/products', 'POST', details, vendor.cookie, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await call('/vendor/products', 'POST', { ...details, stock: -1 }, vendor.cookie)).status, 400);
    const created = await call('/vendor/products', 'POST', { ...details, vendor: other.id, image: 'https://bad.example/image' }, vendor.cookie);
    assert.equal(created.status, 201);
    const { product } = await created.json();
    assert.equal(product.vendor, vendor.id);
    assert.equal(product.image, '');
    assert.equal((await call(`/products/${product._id}`)).status, 404);
    assert.equal((await (await call(`/products?category=${details.category}`)).json()).pagination.total, 0);
    assert.equal((await (await call('/vendor/products', 'GET', undefined, other.cookie)).json()).pagination.total, 0);
    assert.equal((await call(`/vendor/products/${product._id}`, 'PUT', details, other.cookie)).status, 404);
    assert.equal((await call('/vendor/products/invalid', 'PUT', details, vendor.cookie)).status, 400);
    const published = await call(`/vendor/products/${product._id}`, 'PUT', { ...details, status: 'published' }, vendor.cookie);
    assert.equal(published.status, 200);
    const visible = await (await call(`/products/${product._id}`)).json();
    assert.equal(visible.product.vendor.name, 'vendor');
    assert.equal(visible.product.vendor.email, undefined);
    assert.equal(visible.product.imagePublicId, undefined);
    assert.equal((await (await call(`/products?category=${details.category}`)).json()).pagination.total, 1);
    let uploads = 0;
    cloud.uploadProductImage = async () => { uploads++; return { image: 'https://example.com/test.png', imagePublicId: 'test-only' }; };
    cloud.deleteProductImage = async () => ({ result: 'ok' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const upload = (cookie, bytes = png) => fetch(base + `/vendor/products/${product._id}/image`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: bytes });
    assert.equal((await upload(other.cookie)).status, 404);
    assert.equal(uploads, 0);
    assert.equal((await upload(shopper.cookie)).status, 403);
    assert.equal((await upload(vendor.cookie, Buffer.from('not an image'))).status, 400);
    assert.equal((await upload(vendor.cookie, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload(vendor.cookie)).status, 200);
    assert.equal(uploads, 1);
    cloud.uploadProductImage = async () => { throw new Error('Simulated Cloudinary denial'); };
    assert.equal((await upload(vendor.cookie)).status, 502);
    assert.equal((await Product.findById(product._id)).image, 'https://example.com/test.png');
    assert.equal((await call(`/vendor/products/${product._id}`, 'PUT', details, vendor.cookie)).status, 200);
    assert.equal((await call(`/products/${product._id}`)).status, 404);
    // Roles are read from MongoDB for every request, rather than trusted from JWT claims.
    await User.updateOne({ _id: vendor.id }, { $set: { role: 'user' } });
    assert.equal((await call('/vendor/products', 'GET', undefined, vendor.cookie)).status, 403);
    console.log('PASS: roles, ownership, validation, drafts, publishing, unpublishing, vendor privacy, origin checks, image limits and failure handling (Cloudinary mocked)');
  } finally {
    cloud.uploadProductImage = originalUpload;
    cloud.deleteProductImage = originalDelete;
    if (mongoose.connection.readyState === 1) {
      await Product.deleteMany({ vendor: { $in: users } });
      await User.deleteMany({ email: { $in: emails } });
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error.message); process.exitCode = 1; });
