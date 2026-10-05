const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  role: { type: String, enum: ['user', 'vendor'], default: 'user' },
  // select: false keeps the hash out of normal database queries.
  password: { type: String, required: true, select: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
