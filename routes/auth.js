const express = require('express');
const { rateLimit } = require('express-rate-limit');
const authController = require('../controllers/authController');
const requireAuth = require('../middleware/auth');
const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Try again in 15 minutes.' } });

// Routes connect URLs to controllers and apply the required middleware.
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.get('/me', requireAuth, authController.getCurrentUser);
router.post('/logout', authController.logout);

module.exports = router;
