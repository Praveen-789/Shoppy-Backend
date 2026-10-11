const WishlistItem = require('../models/WishlistItem');
const Product = require('../models/Product');
async function getWishlist(user) {
  const rows = await WishlistItem.find({ user }).sort({ createdAt: -1, _id: -1 })
    .populate({ path: 'product', select: 'name price image stock status vendor', populate: { path: 'vendor', select: 'name' } }).lean();
  const items = rows.map(row => {
    const product = row.product;
    const available = Boolean(product && product.status === 'published' && product.vendor);
    return {
      _id: product ? String(product._id) : String(row._id), wishlistItemId: String(row._id), available,
      name: available ? product.name : 'Unavailable product', price: available ? product.price : 0,
      image: available ? product.image : '', stock: available ? product.stock : 0,
      vendor: available ? product.vendor : null,
    };
  });
  return { userId: String(user), items };
}
async function addItem(user, productId) {
  const product = await Product.findOne({ _id: productId, status: 'published', vendor: { $ne: null } });
  if (!product) { const error = new Error('This product is no longer available.'); error.status = 404; throw error; }
  // Saving twice (including from two devices) still creates just one row.
  try { await WishlistItem.updateOne({ user, product: productId }, { $setOnInsert: { user, product: productId } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  return getWishlist(user);
}
async function removeItem(user, id) {
  await WishlistItem.deleteOne({ _id: id, user });
  return getWishlist(user);
}
module.exports = { getWishlist, addItem, removeItem };
