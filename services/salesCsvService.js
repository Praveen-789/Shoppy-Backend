const Order = require('../models/Order');

function createCursor(vendorId, start, endExclusive) {
  const filter = { status: { $ne: 'cancelled' }, vendorOrders: { $elemMatch: { vendor: vendorId, status: { $ne: 'cancelled' } } } };
  if (start || endExclusive) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (endExclusive) filter.createdAt.$lt = endExclusive;
  }
  return Order.find(filter)
    // No customer address, email, payment secrets or live product lookup needed.
    .select('_id createdAt items vendorOrders')
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor({ batchSize: 100 });
}

function csvCell(value) {
  let text = String(value ?? '');
  // Neutralize spreadsheet formulas, including those after leading whitespace.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function* orderRows(order, vendorId) {
  const portion = order.vendorOrders.find(part => String(part.vendor) === String(vendorId));
  if (!portion || portion.status === 'cancelled') return;
  for (const item of order.items) {
    // Matching an order is not enough: it may contain another vendor's products.
    if (String(item.vendor) !== String(vendorId) || item.status === 'cancelled') continue;
    yield csvRow([
      order._id, new Date(order.createdAt).toISOString(), item.name,
      item.quantity, (item.unitPricePaise / 100).toFixed(2),
      (item.quantity * item.unitPricePaise / 100).toFixed(2),
      portion.status, portion.paymentStatus,
    ]);
  }
}

// An async generator produces one chunk when the stream asks for it.
async function* generateCsv(cursor, firstOrder, vendorId) {
  yield '\uFEFF' + csvRow(['Order ID', 'Placed at UTC', 'Product', 'Quantity', 'Unit price INR', 'Line total INR', 'Vendor delivery status', 'Vendor COD status']);
  if (firstOrder) yield* orderRows(firstOrder, vendorId);
  for await (const order of cursor) {
    yield* orderRows(order, vendorId);
  }
}

module.exports = { createCursor, generateCsv, csvCell };
