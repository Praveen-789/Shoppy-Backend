const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }

// Stock, order creation and cart removal commit together, or all roll back.
async function placeOrder(user, checkoutKey, address, expectedItems) {
  const existing = await Order.findOne({ user, checkoutKey }).lean();
  if (existing) return existing;
  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      const duplicate = await Order.findOne({ user, checkoutKey }).session(session).lean();
      if (duplicate) { order = duplicate; return; }
      // console.log('CartItem', CartItem);
      const rows = await CartItem.find({ user }).sort({ _id: 1 }).session(session).lean();
      if (!rows.length) fail(409, 'Your cart is empty.');
      if (rows.length !== expectedItems.length) fail(409, 'Your cart changed. Review it before ordering.');
      const items = [];
      let totalPaise = 0;
      for (const row of rows) {
        const expected = expectedItems.find(item => item.cartItemId === String(row._id));
        const product = await Product.findOne({ _id: row.product, status: 'published', vendor: { $ne: null } }).session(session).lean();
        if (!product) fail(409, 'A product is no longer available. Review your cart.');
        const unitPricePaise = Math.round(product.price * 100);
        if (!expected || expected.quantity !== row.quantity || expected.unitPricePaise !== unitPricePaise) {
          fail(409, 'Prices or quantities changed. Review your cart before ordering.');
        }
        if (!Number.isSafeInteger(unitPricePaise) || !Number.isSafeInteger(row.quantity) || row.quantity < 1) fail(409, 'A product cannot be ordered right now.');
        const result = await Product.updateOne(
          { _id: product._id, status: 'published', vendor: product.vendor, stock: { $gte: row.quantity } },
          { $inc: { stock: -row.quantity } }, { session });
        if (!result.matchedCount) fail(409, `Not enough stock for ${product.name}. Review your cart.`);
        items.push({ product: product._id, vendor: product.vendor, name: product.name, image: product.image, quantity: row.quantity, unitPricePaise });
        totalPaise += unitPricePaise * row.quantity;
        if (!Number.isSafeInteger(totalPaise)) fail(409, 'The order total is too large.');
      }
      const created = await Order.create([{ user, checkoutKey, address, items, totalPaise, deliveryFeePaise: 0 }], { session });
      order = created[0].toObject();
      await CartItem.deleteMany({ user, _id: { $in: rows.map(row => row._id) } }, { session });
    });
    // console.log('Order', order);
    return order;
  } catch (error) {
    // Two requests with the same key may race; both must return the same saved order.
    if (error.code === 11000) {
      const saved = await Order.findOne({ user, checkoutKey }).lean();
      if (saved) return saved;
    }
    if (error.code === 20 || /Transaction numbers are only allowed/.test(error.message)) {
      fail(503, 'Checkout requires MongoDB transactions. Use Atlas or a replica set.');
    }
    throw error;
  } finally { await session.endSession(); }
}
async function listOrders(user, page) {
  const limit = 10;
  const orders = await Order.find({ user }).select('-checkoutKey -user').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
  return { orders: orders.slice(0, limit), hasMore: orders.length > limit };
}
// Ownership and status are checked in the write itself, so a status change cannot race past them.
async function updateAddress(user, id, address) {
  const order = await Order.findOneAndUpdate(
    { _id: id, user, status: 'placed' },
    { $set: { address } },
    { returnDocument: 'after', runValidators: true }
  ).select('-checkoutKey -user').lean();
  if (order) return order;
  if (!await Order.exists({ _id: id, user })) fail(404, 'Order not found.');
  fail(409, 'The address can only be edited while your order is placed.');
}
module.exports = { placeOrder, listOrders, updateAddress };
