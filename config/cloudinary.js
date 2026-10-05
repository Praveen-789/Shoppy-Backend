const cloudinary = require('cloudinary').v2;

// Called when needed so missing image credentials do not prevent login or browsing.
function getCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary settings are incomplete. Check the backend .env.');
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return cloudinary;
}

module.exports = getCloudinary;
