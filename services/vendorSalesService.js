const mongoose = require('mongoose');
const Order = require('../models/Order');

async function getSales(vendorId, start, endExclusive, chartPeriod) {
  // Aggregation does not automatically cast strings to MongoDB ObjectIds.
  const vendor = new mongoose.Types.ObjectId(vendorId);
  const filter = { 'vendorOrders.vendor': vendor };
  if (start || endExclusive) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (endExclusive) filter.createdAt.$lt = endExclusive;
  }
  const [result] = await Order.aggregate([
    { $match: filter },
    { $unwind: '$vendorOrders' },
    // The first match finds orders; this one removes other vendors' portions.
    { $match: { 'vendorOrders.vendor': vendor } },
    { $facet: {
      dailySales: [
        { $match: { createdAt: { $gte: chartPeriod.start, $lt: chartPeriod.endExclusive } } },
        { $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } },
          orderCount: { $sum: 1 },
          orderedValuePaise: { $sum: '$vendorOrders.subtotalPaise' },
        } },
        { $sort: { _id: 1 } },
      ],
      summary: [{ $group: {
        _id: null,
        orderCount: { $sum: 1 },
        deliveredOrderCount: { $sum: { $cond: [{ $eq: ['$vendorOrders.status', 'delivered'] }, 1, 0] } },
        orderedValuePaise: { $sum: '$vendorOrders.subtotalPaise' },
        deliveredSalesPaise: { $sum: { $cond: [{ $eq: ['$vendorOrders.status', 'delivered'] }, '$vendorOrders.subtotalPaise', 0] } },
        collectedCodPaise: { $sum: { $cond: [{ $eq: ['$vendorOrders.paymentStatus', 'collected'] }, '$vendorOrders.subtotalPaise', 0] } },
        pendingCodPaise: { $sum: { $cond: [{ $eq: ['$vendorOrders.paymentStatus', 'pending'] }, '$vendorOrders.subtotalPaise', 0] } },
      } }, { $project: { _id: 0 } }],
      topProducts: [
        { $match: { 'vendorOrders.status': 'delivered' } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $unwind: '$items' },
        { $match: { 'items.vendor': vendor } },
        { $group: {
          _id: '$items.product', name: { $first: '$items.name' },
          deliveredQuantity: { $sum: '$items.quantity' },
          deliveredSalesPaise: { $sum: { $multiply: ['$items.unitPricePaise', '$items.quantity'] } },
        } },
        { $sort: { deliveredQuantity: -1, deliveredSalesPaise: -1, _id: 1 } },
        { $limit: 5 },
        { $project: { _id: 0, productId: '$_id', name: 1, deliveredQuantity: 1, deliveredSalesPaise: 1 } },
      ],
    } },
  ]);
  // MongoDB only returns days with orders. Add quiet days so gaps are honest.
  const dailyByDate = new Map(result.dailySales.map(day => [day._id, day]));
  const days = [];
  for (let time = chartPeriod.start.getTime(); time < chartPeriod.endExclusive.getTime(); time += 24 * 60 * 60 * 1000) {
    const date = new Date(time + 330 * 60 * 1000).toISOString().slice(0, 10);
    const saved = dailyByDate.get(date);
    days.push({ date, orderCount: saved?.orderCount || 0, orderedValuePaise: saved?.orderedValuePaise || 0 });
  }
  return {
    currency: 'INR',
    summary: result.summary[0] || {
      orderCount: 0, deliveredOrderCount: 0, orderedValuePaise: 0,
      deliveredSalesPaise: 0, collectedCodPaise: 0, pendingCodPaise: 0,
    },
    topProducts: result.topProducts,
    dailySales: { from: chartPeriod.from, to: chartPeriod.to, days },
  };
}
module.exports = { getSales };
