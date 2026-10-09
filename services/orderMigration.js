const Order = require('../models/Order');
const { statuses, buildVendorOrders, overallStatus, overallPayment } = require('./fulfilment');
async function migrateVendorOrders(filter = {}) {
  const missing = { $or: [{ vendorOrders: { $exists: false } }, { vendorOrders: { $size: 0 } }] };
  let migrated = 0;
  for await (const order of Order.find({ $and: [filter, missing] }).lean().cursor()) {
    // Existing order snapshots are authoritative; don't change stock or totals.
    const status = statuses.includes(order.status) ? order.status : 'placed';
    const paymentStatus = order.paymentStatus === 'collected' ? 'collected' : 'pending';
    const vendorOrders = await buildVendorOrders(order.items, { status, paymentStatus, at: order.createdAt });
    if (!vendorOrders.length) throw new Error('Cannot migrate an order without purchased items.');
    const result = await Order.updateOne({ $and: [{ _id: order._id }, missing] }, {
      $set: { vendorOrders, fulfilmentVersion: 0, status: overallStatus(vendorOrders), paymentStatus: overallPayment(vendorOrders) },
    }, { runValidators: true });
    migrated += result.modifiedCount;
  }
  return migrated;
}
module.exports = { migrateVendorOrders };
