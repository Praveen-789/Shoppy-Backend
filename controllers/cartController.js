const mongoose = require('mongoose');
const service = require('../services/cartService');
async function handle(request, response, next) {
  try {
    const user = request.user.id;
    let result;
    if (request.method === 'GET') result = await service.getCart(user);
    else if (request.method === 'POST') {
      if (!mongoose.isObjectIdOrHexString(request.body?.productId)) return response.status(400).json({ message: 'Invalid product ID.' });
      result = await service.addItem(user, request.body.productId);
    } else if (request.params.id) {
      if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ message: 'Invalid cart item ID.' });
      if (request.method === 'PATCH') {
        const quantity = request.body?.quantity;
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) return response.status(400).json({ message: 'Quantity must be a positive whole number.' });
        result = await service.setQuantity(user, request.params.id, quantity);
      } else result = await service.removeItem(user, request.params.id);
    } else result = await service.clearCart(user);
    response.json(result);
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
}
module.exports = { handle };
