const mongoose = require('mongoose');
const service = require('../services/wishlistService');
async function handle(request, response, next) {
  try {
    const user = request.user.id;
    let result;
    if (request.method === 'GET') result = await service.getWishlist(user);
    else {
      const id = request.method === 'POST' ? request.body?.productId : request.params.id;
      if (!mongoose.isObjectIdOrHexString(id)) return response.status(400).json({ message: 'Invalid product or wishlist item ID.' });
      result = request.method === 'POST' ? await service.addItem(user, id) : await service.removeItem(user, id);
    }
    response.json(result);
  } catch (error) {
    if (error.status) return response.status(error.status).json({ message: error.message });
    next(error);
  }
}
module.exports = { handle };
