const router = require('express').Router();
const controller = require('../controllers/customerController');
const { verifyToken, requireRole } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimiter');

router.use(strictLimiter(), verifyToken, requireRole('customer'));
router.get('/shipments', controller.listCustomerShipments);
router.get('/shipments/:id', controller.getCustomerShipment);

module.exports = router;
