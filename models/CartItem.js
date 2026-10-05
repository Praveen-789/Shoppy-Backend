const mongoose = require('mongoose');
const cartItemSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, max: 1000000, validate: Number.isSafeInteger },
}, { timestamps: true });
cartItemSchema.index({ user: 1, product: 1 }, { unique: true });
module.exports = mongoose.model('CartItem', cartItemSchema);
