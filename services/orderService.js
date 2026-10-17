const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CartItem = require('../models/CartItem');
const { buildVendorOrders, overallStatus, overallPayment } = require('./fulfilment');
function customerView(order) {
  return { ...order, payablePaise: order.payablePaise ?? (order.status === 'cancelled' ? 0 : order.totalPaise),
    vendorOrders: order.vendorOrders.map(portion => ({ ...portion,
      payablePaise: portion.payablePaise ?? (portion.status === 'cancelled' ? 0 : portion.subtotalPaise) })) };
}
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
      const vendorOrders = await buildVendorOrders(items, { session });
      const created = await Order.create([{ user, checkoutKey, address, items, vendorOrders, totalPaise, payablePaise: totalPaise, deliveryFeePaise: 0 }], { session });
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
  const orders = await Order.find({ user }).select('-checkoutKey -user -fulfilmentVersion').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
  return { orders: orders.slice(0, limit).map(customerView), hasMore: orders.length > limit };
}
// Ownership and status are checked in the write itself, so a status change cannot race past them.
async function updateAddress(user, id, address) {
  const order = await Order.findOneAndUpdate(
    { _id: id, user, status: 'placed', vendorOrders: { $not: { $elemMatch: { status: { $nin: ['placed', 'cancelled'] } } } } },
    { $set: { address } },
    { returnDocument: 'after', runValidators: true }
  ).select('-checkoutKey -user -fulfilmentVersion').lean();
  if (order) return customerView(order);
  if (!await Order.exists({ _id: id, user })) fail(404, 'Order not found.');
  fail(409, 'The address can only be edited before any vendor confirms your order.');
}
// Both endpoints share one transaction so item and whole-order retries cannot double-restock.
async function cancelOrder(user, id, productId = null) {
  const session = await mongoose.startSession();
  let cancelled;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, user }).session(session).lean();
      if (!order) fail(404, 'Order not found.');
      const target = productId && order.items.find(item => String(item.product) === String(productId));
      if (productId && !target) fail(404, 'Order item not found.');
      if (order.status === 'cancelled' || target?.status === 'cancelled') { cancelled = order; return; }
      const portions = order.vendorOrders.length ? order.vendorOrders :
        await buildVendorOrders(order.items, { session, at: order.createdAt, status: order.status, paymentStatus: order.paymentStatus });
      const affected = portions.filter(portion => portion.status !== 'cancelled' &&
        (!productId || String(portion.vendor) === String(target.vendor)));
      if (!affected.length || affected.some(portion => portion.status !== 'placed' || portion.paymentStatus !== 'pending')) {
        fail(409, productId ? 'This item can only be cancelled before its seller confirms.' : 'Orders can only be cancelled before any remaining vendor confirms.');
      }
      const at = new Date();
      const restoring = order.items.filter(item => item.status !== 'cancelled' && (!productId || String(item.product) === String(productId)));
      const items = order.items.map(item => restoring.includes(item) ? { ...item, status: 'cancelled', cancelledAt: at } : item);
      const vendorOrders = portions.map(portion => {
        const active = items.filter(item => String(item.vendor) === String(portion.vendor) && item.status !== 'cancelled');
        const payablePaise = active.reduce((sum, item) => sum + item.quantity * item.unitPricePaise, 0);
        if (active.length || portion.status === 'cancelled') return { ...portion, payablePaise };
        return { ...portion, payablePaise, status: 'cancelled', paymentStatus: 'not_required',
          history: [...portion.history, { status: 'cancelled', at }] };
      });
      const status = overallStatus(vendorOrders);
      // Same version as vendor confirmations; a concurrent write retries or loses safely.
      cancelled = await Order.findOneAndUpdate(
        { _id: id, user, fulfilmentVersion: order.fulfilmentVersion },
        { $set: { items, vendorOrders, status, paymentStatus: overallPayment(vendorOrders),
          payablePaise: vendorOrders.reduce((sum, portion) => sum + portion.payablePaise, 0),
          ...(status === 'cancelled' ? { cancelledAt: at } : {}) },
          $inc: { fulfilmentVersion: 1 } },
        { session, returnDocument: 'after', runValidators: true }
      ).lean();
      if (!cancelled) fail(409, 'This order changed. Refresh and try again.');
      for (const item of restoring) {
        const result = await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, { session });
        if (!result.matchedCount) fail(409, 'A product is missing. Cancellation could not restore stock.');
      }
    });
    const { user: owner, checkoutKey, fulfilmentVersion, ...publicOrder } = cancelled;
    return customerView(publicOrder);
  } catch (error) {
    if (error.code === 20 || /Transaction numbers are only allowed/.test(error.message)) {
      fail(503, 'Cancellation requires MongoDB transactions. Use Atlas or a replica set.');
    }
    throw error;
  } finally { await session.endSession(); }
}
module.exports = { placeOrder, listOrders, updateAddress, cancelOrder };
