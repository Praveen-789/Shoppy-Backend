const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../server');
const Product = require('../models/Product');

async function test() {
  let server;
  let product;
  let secondProduct;
  const category = `Test-${new mongoose.Types.ObjectId()}`;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Product.init();
    const invalid = new Product({ name: 'Invalid', slug: 'invalid', description: 'Test', category: 'Test', price: -1, stock: 1.5 });
    await assert.rejects(invalid.validate(), error => {
      assert.ok(error.errors.price);
      assert.ok(error.errors.stock);
      return true;
    });
    product = await Product.create({ name: 'Smoke test product', slug: `smoke-${new mongoose.Types.ObjectId()}`, description: 'Temporary test product', price: 123.45, category, status: 'published', vendor: new mongoose.Types.ObjectId(), stock: 2 });
    secondProduct = await Product.create({ name: 'Literal [test] item', slug: `smoke-${new mongoose.Types.ObjectId()}`, description: 'Second temporary product', price: 10, category, status: 'published', vendor: new mongoose.Types.ObjectId(), stock: 0 });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/products`;
    const list = await fetch(`${base}?category=${category}`);
    assert.equal(list.status, 200);
    const { products } = await list.json();
    assert.ok(products.some(item => item._id === product.id));
    const first = await (await fetch(`${base}?category=${category}&limit=1`)).json();
    const second = await (await fetch(`${base}?category=${category}&limit=1&page=2`)).json();
    assert.equal(first.products.length, 1);
    assert.equal(first.pagination.total, 2);
    assert.equal(first.pagination.hasMore, true);
    assert.equal(second.pagination.hasMore, false);
    assert.notEqual(first.products[0]._id, second.products[0]._id);
    assert.ok(first.categories.includes(category));
    const beyond = await (await fetch(`${base}?category=${category}&limit=1&page=3`)).json();
    assert.equal(beyond.products.length, 0);
    assert.equal(beyond.pagination.hasMore, false);
    const search = await (await fetch(`${base}?category=${category}&search=${encodeURIComponent('[TEST]')}`)).json();
    assert.equal(search.pagination.total, 1);
    assert.equal(search.products[0]._id, secondProduct.id);
    for (const query of ['page=0', 'page=1.5', 'limit=49', 'limit=-1', 'search[x]=bad', 'category[x]=bad', 'page=1&page=2']) {
      assert.equal((await fetch(`${base}?${query}`)).status, 400);
    }
    const detail = await fetch(`${base}/${product.id}`);
    assert.equal(detail.status, 200);
    const data = await detail.json();
    assert.equal(data.product.price, 123.45);
    assert.equal(data.product.stock, 2);
    assert.equal(data.product.slug, undefined);
    assert.equal((await fetch(`${base}/invalid`)).status, 400);
    assert.equal((await fetch(`${base}/${new mongoose.Types.ObjectId()}`)).status, 404);
    console.log('PASS: validation, pagination, page boundaries, category, literal search, invalid queries, detail, missing product');
  } finally {
    if (product) await Product.deleteOne({ _id: product._id });
    if (secondProduct) await Product.deleteOne({ _id: secondProduct._id });
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
}
test().catch(error => { console.error(error.message); process.exitCode = 1; });

