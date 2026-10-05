const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, trim: true },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, required: true, trim: true },
  image: { type: String, default: '' },
  imagePublicId: { type: String, default: '', select: false },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
}, { timestamps: true });

productSchema.index({ createdAt: -1, _id: 1 });
productSchema.index({ vendor: 1, createdAt: -1, _id: 1 });
productSchema.index({ status: 1, createdAt: -1, _id: 1 });
productSchema.index({ category: 1, createdAt: -1, _id: 1 });

module.exports = mongoose.model('Product', productSchema);
