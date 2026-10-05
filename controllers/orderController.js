const mongoose = require('mongoose');
const service = require('../services/orderService');
function validateAddress(input) {
  const address = {};
  for (const [field, max] of Object.entries({ name: 120, phone: 20, line1: 200, line2: 200, city: 100, state: 100, postalCode: 6 })) {
    const value = input?.[field];
    if ((field !== 'line2' && typeof value !== 'string') || (value !== undefined && typeof value !== 'string')) throw Object.assign(new Error('Complete your delivery address.'), { status: 400 });
    address[field] = (value || '').trim();
    if ((field !== 'line2' && !address[field]) || address[field].length > max) throw Object.assign(new Error('Check your delivery address fields.'), { status: 400 });
  }
  if (!/^[6-9]\d{9}$/.test(address.phone) || !/^[1-9]\d{5}$/.test(address.postalCode)) throw Object.assign(new Error('Enter a valid Indian mobile number and six-digit PIN code.'), { status: 400 });
  return address;
}
function validateCheckout(body) {
  if (!body || !/^[a-zA-Z0-9-]{16,80}$/.test(body.checkoutKey || '')) throw Object.assign(new Error('Invalid checkout request.'), { status: 400 });
  const address = validateAddress(body.address);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100 ||
    new Set(body.items.map(item => item?.cartItemId)).size !== body.items.length ||
    body.items.some(item => !mongoose.isObjectIdOrHexString(item?.cartItemId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.unitPricePaise) || item.unitPricePaise < 0)) {
    throw Object.assign(new Error('Invalid cart summary. Refresh your cart.'), { status: 400 });
  }
  return address;
}
async function place(request, response, next) {
  try {
    const address = validateCheckout(request.body);
    const order = await service.placeOrder(request.user.id, request.body.checkoutKey, address, request.body.items);
    response.status(201).json({ order: { _id: order._id } });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
}
async function list(request, response, next) {
  try {
    const page = Number(request.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return response.status(400).json({ message: 'Invalid page.' });
    response.json(await service.listOrders(request.user.id, page));
  } catch (error) { next(error); }
}
async function updateAddress(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ message: 'Invalid order ID.' });
    const address = validateAddress(request.body?.address);
    const order = await service.updateAddress(request.user.id, request.params.id, address);
    response.json({ order });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
}
module.exports = { place, list, updateAddress, validateCheckout };
