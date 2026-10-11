const router = require('express').Router();
const { handle } = require('../controllers/wishlistController');
router.use(require('../middleware/auth'));
router.use((request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
router.get('/', handle);
router.post('/items', handle);
router.delete('/items/:id', handle);
module.exports = router;
