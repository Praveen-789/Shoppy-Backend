const mongoose = require('mongoose');
const productService = require('../services/productService');

// Controllers translate HTTP input into service arguments and send HTTP responses.
async function getProducts(request, response) {
  const { page = '1', limit = '12', search = '', category = '' } = request.query;
  if (Object.keys(request.query).some(key => !['page', 'limit', 'search', 'category'].includes(key)) ||
      typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || Number(page) > 100000 ||
      typeof limit !== 'string' || !/^[1-9]\d*$/.test(limit) || Number(limit) > 48 ||
      typeof search !== 'string' || search.length > 120 ||
      typeof category !== 'string' || category.length > 120) {
    return response.status(400).json({ message: 'Invalid product filters or pagination. Limit must be between 1 and 48.' });
  }

  const result = await productService.getProducts({
    page: Number(page), limit: Number(limit), search: search.trim(), category,
  });
  response.json(result);
}

async function getProductById(request, response) {
  if (!mongoose.isObjectIdOrHexString(request.params.id)) {
    return response.status(400).json({ message: 'Invalid product ID.' });
  }
  const product = await productService.getProductById(request.params.id);
  if (!product) return response.status(404).json({ message: 'Product not found.' });
  response.json({ product });
}

// Express 5 forwards rejected async handlers to our existing error middleware.
module.exports = { getProducts, getProductById };
