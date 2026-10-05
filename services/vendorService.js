const { randomUUID } = require('node:crypto');
const Product = require('../models/Product');
const cloudinaryService = require('./cloudinaryService');

async function getProducts(vendor, page) {
  const filter = { vendor };
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * 12).limit(12).lean(),
    Product.countDocuments(filter),
  ]);
  return { products, pagination: { page, total, hasMore: page * 12 < total } };
}

async function createProduct(vendor, details) {
  return Product.create({ ...details, vendor, slug: randomUUID() });
}

async function updateProduct(vendor, id, details) {
  return Product.findOneAndUpdate({ _id: id, vendor }, { $set: details }, { returnDocument: 'after', runValidators: true });
}

async function replaceImage(vendor, id, buffer) {
  const product = await Product.findOne({ _id: id, vendor }).select('+imagePublicId');
  if (!product) return null;
  const uploaded = await cloudinaryService.uploadProductImage(buffer);
  let updated;
  try {
    // Avoid overwriting another upload which completed while this one was running.
    updated = await Product.findOneAndUpdate({ _id: id, vendor, image: product.image },
      { $set: uploaded }, { returnDocument: 'after' });
    if (!updated) throw new Error('Product image changed. Please retry.');
  } catch (error) {
    await cloudinaryService.deleteProductImage(uploaded.imagePublicId).catch(() => console.error('Unused image cleanup failed:', uploaded.imagePublicId));
    throw error;
  }
  if (product.imagePublicId) {
    await cloudinaryService.deleteProductImage(product.imagePublicId).catch(() => console.error('Previous image cleanup failed:', product.imagePublicId));
  }
  return updated;
}

module.exports = { getProducts, createProduct, updateProduct, replaceImage };

