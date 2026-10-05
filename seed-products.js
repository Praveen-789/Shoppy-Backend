const path = require('node:path');
const mongoose = require('mongoose');
const Product = require('./models/Product');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const products = [
  { slug: 'everyday-tote', name: 'Everyday Tote', description: 'A roomy cotton tote for groceries, books, and everyday adventures.', price: 499, category: 'Accessories', stock: 25 },
  { slug: 'ceramic-mug', name: 'Ceramic Mug', description: 'A simple ceramic mug for your slow mornings and favourite warm drinks.', price: 349, category: 'Home', stock: 40 },
  { slug: 'desk-notebook', name: 'Desk Notebook', description: 'A dotted notebook for ideas, plans, and the occasional brilliant doodle.', price: 199, category: 'Stationery', stock: 60 },
  { slug: 'classic-tee', name: 'Classic Cotton Tee', description: 'A comfortable cotton T-shirt made for an easy everyday look.', price: 699, category: 'Clothing', stock: 20 },
  { slug: 'table-planter', name: 'Table Planter', description: 'A compact planter to give your desk or windowsill a little greenery.', price: 449, category: 'Home', stock: 15 },
  { slug: 'weekend-pouch', name: 'Weekend Pouch', description: 'Keep small essentials together with this handy zipped pouch.', price: 299, category: 'Accessories', stock: 0 },
];

async function seed() {
  try {
    if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI in .env first.');
    await mongoose.connect(process.env.MONGO_URI);
    await Product.init();
    // Insert missing samples without changing existing products or stock.
    const result = await Product.bulkWrite(products.map(product => ({
      updateOne: { filter: { slug: product.slug }, update: { $setOnInsert: product }, upsert: true, timestamps: false },
    })));
    console.log(`Added ${result.upsertedCount} sample products. Existing products were preserved.`);
  } finally {
    await mongoose.disconnect();
  }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });
