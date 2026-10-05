const path = require('node:path');
const mongoose = require('mongoose');
process.loadEnvFile(path.join(__dirname, '..', '.env'));
const User = require('../models/User');
const Product = require('../models/Product');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    const users = await User.updateMany({ role: { $exists: false } }, { $set: { role: 'user' } });
    const products = await Product.updateMany({ status: { $exists: false } }, { $set: { status: 'draft' } });
    console.log(`Updated ${users.modifiedCount} existing accounts to user and ${products.modifiedCount} legacy products to draft. No vendor ownership was assigned.`);
  } finally {
    await mongoose.disconnect();
  }
}
migrate().catch(() => { console.error('Migration failed. Check the database connection.'); process.exitCode = 1; });
