const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');

router.post('/',              orderController.createOrder);
router.get('/next-number',    orderController.getNextOrderNumber);
router.get('/',               orderController.getAllOrders);
router.get('/:id',            orderController.getOrderById);
router.patch('/:id/status',   orderController.updateOrderStatus);
router.patch('/:id/payment',  orderController.markOrderPaid);
router.delete('/:id',         orderController.cancelOrder);

module.exports = router;
