const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 120 },
  phone: { type: String, required: true },
  line1: { type: String, required: true, maxlength: 200 },
  line2: { type: String, default: '', maxlength: 200 },
  city: { type: String, required: true, maxlength: 100 },
  state: { type: String, required: true, maxlength: 100 },
  postalCode: { type: String, required: true },
}, { _id: false });
const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  image: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPricePaise: { type: Number, required: true, min: 0 },
}, { _id: false });
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  checkoutKey: { type: String, required: true },
  items: { type: [itemSchema], required: true },
  address: { type: addressSchema, required: true },
  totalPaise: { type: Number, required: true, min: 0 },
  deliveryFeePaise: { type: Number, default: 0 },
  paymentMethod: { type: String, enum: ['cod'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending'], default: 'pending' },
  status: { type: String, enum: ['placed'], default: 'placed' },
}, { timestamps: true });
schema.index({ user: 1, checkoutKey: 1 }, { unique: true });
schema.index({ user: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('Order', schema);
