const mongoose = require('mongoose');
require('../server'); // Loads the project's environment file.
const Order = require('../models/Order');
const { migrateVendorOrders } = require('../services/orderMigration');
async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  await Order.init();
  console.log(`Migrated ${await migrateVendorOrders()} existing orders to vendor fulfilment.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
