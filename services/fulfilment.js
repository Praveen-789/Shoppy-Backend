const User = require('../models/User');
const statuses = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];

function overallStatus(portions) {
  if (portions.every(portion => portion.status === 'delivered')) return 'delivered';
  if (portions.some(portion => portion.status === 'delivered')) return 'partially_delivered';
  if (portions.every(portion => portion.status === portions[0].status)) return portions[0].status;
  return 'processing';
}
function overallPayment(portions) {
  if (portions.every(portion => portion.paymentStatus === 'collected')) return 'collected';
  if (portions.some(portion => portion.paymentStatus === 'collected')) return 'partially_collected';
  return 'pending';
}
// Group purchased snapshots, never today's product prices or owners.
async function buildVendorOrders(items, { session = null, status = 'placed', paymentStatus = 'pending', at = new Date() } = {}) {
  const groups = new Map();
  for (const item of items) {
    const key = String(item.vendor);
    if (!groups.has(key)) groups.set(key, { vendor: item.vendor, subtotalPaise: 0 });
    groups.get(key).subtotalPaise += item.unitPricePaise * item.quantity;
  }
  const vendors = await User.find({ _id: { $in: [...groups.keys()] } }).select('name').session(session).lean();
  return [...groups.entries()].map(([id, group]) => ({
    ...group,
    vendorName: vendors.find(vendor => String(vendor._id) === id)?.name || 'Vendor',
    status, paymentStatus, history: [{ status, at }],
  }));
}
module.exports = { statuses, overallStatus, overallPayment, buildVendorOrders };
