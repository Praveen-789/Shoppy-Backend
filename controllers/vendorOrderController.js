const mongoose = require('mongoose');
const service = require('../services/vendorOrderService');
const { statuses } = require('../services/fulfilment');
async function list(request, response, next) {
  try {
    const page = Number(request.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return response.status(400).json({ message: 'Invalid page.' });
    response.json(await service.listOrders(request.user.id, page));
  } catch (error) { next(error); }
}
async function update(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ message: 'Invalid order ID.' });
    const { status, expectedStatus, cashCollected } = request.body || {};
    if (!statuses.includes(status) || !statuses.includes(expectedStatus) ||
      (cashCollected !== undefined && typeof cashCollected !== 'boolean')) {
      return response.status(400).json({ message: 'Invalid delivery status.' });
    }
    const order = await service.updateStatus(request.user.id, request.params.id, expectedStatus, status, cashCollected);
    response.json({ order });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
}
module.exports = { list, update };
