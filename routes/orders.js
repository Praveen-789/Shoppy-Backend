const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const controller = require('../controllers/orderController');
router.use(requireAuth);
router.use((request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
router.get('/', controller.list);
router.post('/', controller.place);
router.patch('/:id/address', controller.updateAddress);
module.exports = router;
