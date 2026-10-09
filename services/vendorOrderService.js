const Order = require('../models/Order');
const { statuses, overallStatus, overallPayment } = require('./fulfilment');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }

// Return only this vendor's products, subtotal and fulfilment data.
function vendorView(order, vendor) {
  const portion = order.vendorOrders.find(part => String(part.vendor) === String(vendor));
  return {
    _id: order._id, createdAt: order.createdAt, address: order.address,
    items: order.items.filter(item => String(item.vendor) === String(vendor)),
    subtotalPaise: portion.subtotalPaise, status: portion.status,
    paymentStatus: portion.paymentStatus, history: portion.history, paymentMethod: order.paymentMethod,
  };
}

async function listOrders(vendor, page) {
  const limit = 10;
  const orders = await Order.find({ 'vendorOrders.vendor': vendor }).select('-user -checkoutKey')
    .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1).lean();
  return { orders: orders.slice(0, limit).map(order => vendorView(order, vendor)), hasMore: orders?.length > limit };
}

async function updateStatus(vendor, id, expectedStatus, status, cashCollected) {
  const order = await Order.findOne({ _id: id, 'vendorOrders.vendor': vendor }).lean();
  if (!order) fail(404, 'Order not found.');
  const portion = order.vendorOrders.find(part => String(part.vendor) === String(vendor));
  if (portion.status !== expectedStatus) fail(409, 'Order status changed. Refresh before updating.');
  const next = statuses[statuses.indexOf(portion.status) + 1];
  if (!next || status !== next) fail(409, 'Follow the next delivery step. Completed deliveries cannot be changed.');
  if (status === 'delivered' && cashCollected !== true) fail(400, 'Confirm that the cash-on-delivery amount was collected.');
  if (status !== 'delivered' && cashCollected === true) fail(400, 'Cash collection is recorded only when delivery is completed.');
  const paymentStatus = status === 'delivered' ? 'collected' : 'pending';
  const updatedPortions = order.vendorOrders.map(part => String(part.vendor) === String(vendor) ? { ...part, status, paymentStatus } : part);
  // The version prevents a simultaneous vendor update from leaving aggregate status stale.
  // arrayFilters targets only the authenticated vendor's portion.
  const updated = await Order.findOneAndUpdate(
    { _id: id, fulfilmentVersion: order.fulfilmentVersion,
      vendorOrders: { $elemMatch: { vendor, status: expectedStatus } } },
    { $set: {
      'vendorOrders.$[portion].status': status,
      'vendorOrders.$[portion].paymentStatus': paymentStatus,
      status: overallStatus(updatedPortions),
      paymentStatus: overallPayment(updatedPortions),
    },
      $push: { 'vendorOrders.$[portion].history': { status, at: new Date() } },
      $inc: { fulfilmentVersion: 1 } },
    { arrayFilters: [{ 'portion.vendor': vendor, 'portion.status': expectedStatus }],
      returnDocument: 'after', runValidators: true }
  ).lean();
  if (!updated) fail(409, 'This order changed while you were updating it. Refresh and try again.');
  return vendorView(updated, vendor);
}
module.exports = { listOrders, updateStatus };
