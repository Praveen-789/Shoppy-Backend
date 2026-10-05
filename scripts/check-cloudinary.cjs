const path = require('node:path');
process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { uploadProductImage, deleteProductImage } = require('../services/cloudinaryService');

async function check() {
  // A tiny test PNG. Upload and delete only this newly created test asset.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const uploaded = await uploadProductImage(png);
  console.log('PASS: authenticated image upload to shoppy/products.');
  try {
    const deleted = await deleteProductImage(uploaded.imagePublicId);
    if (deleted.result !== 'ok') throw new Error('Cleanup did not complete.');
    console.log('PASS: test image deleted. No product records were changed.');
  } catch {
    console.error('Test image cleanup failed. Remove this test asset from Cloudinary:', uploaded.imagePublicId);
    process.exitCode = 1;
  }
}

check().catch(error => {
  // Do not print SDK errors: they may contain credential-bearing request details.
  const status = Number(error.http_code) || 'unavailable';
  console.error(`Cloudinary upload check failed (HTTP ${status}). Check credentials and folder upload permissions.`);
  process.exitCode = 1;
});
