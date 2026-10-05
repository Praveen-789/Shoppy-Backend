const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function getCart(user) {
  const rows = await CartItem.find({ user }).sort({ createdAt: 1, _id: 1 }).populate({ path: 'product', select: 'name price image stock status vendor', populate: { path: 'vendor', select: 'name' } }).lean();
  const items = rows.map(row => {
    const product = row.product;
    const available = product && product.status === 'published' && product.vendor;
    return { _id: product ? String(product._id) : String(row._id), cartItemId: String(row._id),
      name: available ? product.name : 'Unavailable product', price: available ? product.price : 0,
      image: available ? product.image : '', stock: available ? product.stock : 0,
      vendor: available ? product.vendor : null, quantity: row.quantity };
  });
  return { userId: String(user), items };
}
async function availableProduct(id) {
  const product = await Product.findOne({ _id: id, status: 'published', vendor: { $ne: null } });
  if (!product) fail(404, 'This product is no longer available.');
  if (product.stock < 1) fail(409, 'This product is out of stock.');
  return product;
}
async function addItem(user, productId) {
  const product = await availableProduct(productId);
  const filter = { user, product: productId, quantity: { $lt: product.stock } };
  let result = await CartItem.updateOne(filter, { $inc: { quantity: 1 } });
  if (!result.matchedCount) {
    try { await CartItem.create({ user, product: productId, quantity: 1 }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      // Another device may have inserted this item. Increment atomically, within stock.
      result = await CartItem.updateOne(filter, { $inc: { quantity: 1 } });
      if (!result.matchedCount) fail(409, 'You have reached the available stock for this product.');
    }
  }
  return getCart(user);
}
async function setQuantity(user, itemId, quantity) {
  const item = await CartItem.findOne({ _id: itemId, user });
  if (!item) fail(404, 'Cart item not found.');
  const product = await availableProduct(item.product);
  if (quantity > product.stock) fail(409, `Only ${product.stock} available. Reduce the quantity.`);
  await CartItem.updateOne({ _id: itemId, user }, { $set: { quantity } }, { runValidators: true });
  return getCart(user);
}
async function removeItem(user, itemId) {
  await CartItem.deleteOne({ _id: itemId, user });
  return getCart(user);
}
async function clearCart(user) { await CartItem.deleteMany({ user }); return getCart(user); }
module.exports = { getCart, addItem, setQuantity, removeItem, clearCart };

