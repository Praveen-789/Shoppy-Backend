const mongoose = require('mongoose');
const vendorService = require('../services/vendorService');

function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { name, description, category, price, stock, status } = body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      typeof description !== 'string' || !description.trim() || description.trim().length > 1000 ||
      typeof category !== 'string' || !category.trim() || category.trim().length > 120 ||
      typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 10000000 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.000001 ||
      !Number.isSafeInteger(stock) || stock < 0 || stock > 1000000 ||
      !['draft', 'published'].includes(status)) return null;
  // Ownership and Cloudinary fields are never accepted from the client.
  return { name: name.trim(), description: description.trim(), category: category.trim(), price, stock, status };
}

async function getProducts(request, response) {
  const page = request.query.page || '1';
  if (typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || Number(page) > 100000) return response.status(400).json({ message: 'Invalid page.' });
  response.json(await vendorService.getProducts(request.user.id, Number(page)));
}

async function saveProduct(request, response) {
  const details = validateProduct(request.body);
  if (!details) return response.status(400).json({ message: 'Check the product fields. Price must have at most two decimal places; stock must be a nonnegative whole number.' });
  const product = request.params.id
    ? await vendorService.updateProduct(request.user.id, request.params.id, details)
    : await vendorService.createProduct(request.user.id, details);
  if (!product) return response.status(404).json({ message: 'Product not found in your store.' });
  response.status(request.params.id ? 200 : 201).json({ product });
}

function validateId(request, response, next) {
  if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ message: 'Invalid product ID.' });
  next();
}

async function uploadImage(request, response) {
  const file = request.body;
  const isImage = Buffer.isBuffer(file) && (
    (file.length > 3 && file.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
    (file.length > 8 && file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.length > 12 && file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP'));
  if (!isImage) return response.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image up to 5 MB.' });
  try {
    const product = await vendorService.replaceImage(request.user.id, request.params.id, file);
    if (!product) return response.status(404).json({ message: 'Product not found in your store.' });
    response.json({ product });
  } catch {
    response.status(502).json({ message: 'Image upload failed. Your product details are saved. Please retry; if this continues, contact support.' });
  }
}

module.exports = { getProducts, saveProduct, validateId, uploadImage };
