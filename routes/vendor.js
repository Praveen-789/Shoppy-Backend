const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/auth');
const requireVendor = require('../middleware/vendor');
const controller = require('../controllers/vendorController');
const router = express.Router();
router.use(requireAuth, requireVendor);
router.use((request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
router.get('/products', controller.getProducts);
router.post('/products', controller.saveProduct);
router.put('/products/:id', controller.validateId, controller.saveProduct);
router.post('/products/:id/image', controller.validateId,
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { message: 'Too many uploads. Try again later.' } }),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), controller.uploadImage);
module.exports = router;
