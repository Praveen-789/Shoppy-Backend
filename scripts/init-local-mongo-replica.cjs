const mongoose = require('mongoose');
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, directConnection: true });
  const admin = mongoose.connection.db.admin();
  try { await admin.command({ replSetGetStatus: 1 }); }
  catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({ replSetInitiate: { _id: 'shoppy-rs', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary && hello.setName === 'shoppy-rs') {
      console.log('MongoDB shoppy-rs is ready for transactions.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Replica set did not become primary in time.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
