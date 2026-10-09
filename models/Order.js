const mongoose = require('mongoose');
const { statuses } = require('../services/fulfilment');

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
const statusHistorySchema = new mongoose.Schema({
  status: { type: String, enum: statuses, required: true },
  at: { type: Date, required: true },
}, { _id: false });
const vendorOrderSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  vendorName: { type: String, required: true },
  subtotalPaise: { type: Number, required: true, min: 0 },
  status: { type: String, enum: statuses, default: 'placed' },
  paymentStatus: { type: String, enum: ['pending', 'collected'], default: 'pending' },
  history: { type: [statusHistorySchema], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  checkoutKey: { type: String, required: true },
  items: { type: [itemSchema], required: true },
  address: { type: addressSchema, required: true },
  totalPaise: { type: Number, required: true, min: 0 },
  deliveryFeePaise: { type: Number, default: 0 },
  paymentMethod: { type: String, enum: ['cod'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'partially_collected', 'collected'], default: 'pending' },
  status: { type: String, enum: [...statuses, 'processing', 'partially_delivered'], default: 'placed' },
  vendorOrders: { type: [vendorOrderSchema], default: [] },
  fulfilmentVersion: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ user: 1, checkoutKey: 1 }, { unique: true });
schema.index({ user: 1, createdAt: -1, _id: -1 });
schema.index({ 'vendorOrders.vendor': 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model('Order', schema);
