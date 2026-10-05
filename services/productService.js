const Product = require('../models/Product');

// Services work with data; they do not use Express request or response objects.
const fields = 'name description price category image stock vendor';

async function getProducts({ page = 1, limit = 12, search = '', category = '' } = {}) {
  const filter = { status: 'published', vendor: { $ne: null } };
  if (category) filter.category = category;
  if (search) {
    // Treat punctuation as plain text rather than a user-supplied regular expression.
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'description'].map(field => ({ [field]: { $regex: escaped, $options: 'i' } }));
  }

  const [products, total, categories] = await Promise.all([
    Product.find(filter).select(fields).sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * limit).limit(limit).populate('vendor', 'name').lean(),
    Product.countDocuments(filter),
    Product.distinct('category', { status: 'published', vendor: { $ne: null } }),
  ]);

  return {
    products,
    categories: categories.sort(),
    pagination: { page, limit, total, hasMore: page * limit < total },
  };
}

async function getProductById(id) {
  return Product.findOne({ _id: id, status: 'published', vendor: { $ne: null } }).select(fields).populate('vendor', 'name').lean();
}

module.exports = { getProducts, getProductById };
