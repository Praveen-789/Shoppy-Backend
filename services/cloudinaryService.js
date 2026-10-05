const getCloudinary = require('../config/cloudinary');

const PRODUCT_FOLDER = 'shoppy/products';

function uploadProductImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new Error('Provide an image smaller than or equal to 5 MB.');
  }
  const cloudinary = getCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: 'image',
      asset_folder: PRODUCT_FOLDER,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      overwrite: false,
      timeout: 30000,
    }, (error, result) => {
      if (error) return reject(error);
      resolve({ image: result.secure_url, imagePublicId: result.public_id });
    });
    stream.on('error', reject);
    stream.end(buffer);
  });
}

async function deleteProductImage(publicId) {
  return getCloudinary().uploader.destroy(publicId, { resource_type: 'image', invalidate: true, timeout: 30000 });
}

module.exports = { uploadProductImage, deleteProductImage };
