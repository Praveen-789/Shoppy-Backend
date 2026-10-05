const express = require('express');
const productController = require('../controllers/productController');
const router = express.Router();

// Browsing is public. Routes only connect URLs to controller functions.
router.get('/', productController.getProducts);
router.get('/:id', productController.getProductById);

module.exports = router;
