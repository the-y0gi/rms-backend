const Order = require('../models/order.model');
const logger = require('../../../shared/utils/logger');

// ── Create Order ──────────────────────────────────────────────
exports.createOrder = async (orderData) => {
  try {
    const orderNumber = await Order.generateOrderNumber(orderData.orderType);

    // If pay-later → paymentStatus = unpaid, no payments array needed
    const paymentStatus =
      orderData.paymentTiming === 'pay-later' ? 'unpaid' : 'paid';

    const order = new Order({
      ...orderData,
      orderNumber,
      paymentStatus,
      statusHistory: [{ status: 'pending', changedAt: new Date() }],
    });

    await order.save();
    logger.info(`Order created: ${orderNumber}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: createOrder - ${error.message}`);
    throw error;
  }
};

// ── Get All Orders ────────────────────────────────────────────
exports.getAllOrders = async (filters = {}) => {
  try {
    const query = {};

    if (filters.status)      query.status = filters.status;
    if (filters.orderType)   query.orderType = filters.orderType;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;

    // Date filter: default today
    if (filters.date) {
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(query)
      .sort({ scheduledAt: 1, createdAt: 1 }) // Order Later orders come first when their time arrives
      .lean();

    return orders;
  } catch (error) {
    logger.error(`Order Service Error: getAllOrders - ${error.message}`);
    throw error;
  }
};

// ── Get Single Order ──────────────────────────────────────────
exports.getOrderById = async (id) => {
  try {
    const order = await Order.findById(id).lean();
    if (!order) throw new Error('Order not found.');
    return order;
  } catch (error) {
    logger.error(`Order Service Error: getOrderById - ${error.message}`);
    throw error;
  }
};

// ── Update Order Status ───────────────────────────────────────
exports.updateOrderStatus = async (id, status, note = '') => {
  try {
    const validTransitions = {
      pending:   ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready:     ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };

    const order = await Order.findById(id);
    if (!order) throw new Error('Order not found.');

    const allowed = validTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new Error(
        `Cannot transition from "${order.status}" to "${status}".`
      );
    }

    order.status = status;
    order.statusHistory.push({ status, changedAt: new Date(), note });
    await order.save();

    logger.info(`Order ${order.orderNumber} status → ${status}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderStatus - ${error.message}`);
    throw error;
  }
};

// ── Mark Order as Paid (Pay Later → Paid) ─────────────────────
exports.markOrderPaid = async (id, payments) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error('Order not found.');
    if (order.paymentStatus === 'paid') throw new Error('Order is already paid.');

    order.paymentStatus = 'paid';
    order.paymentTiming = 'pay-now'; // retroactively mark
    if (payments && payments.length > 0) {
      order.payments = payments;
    }
    await order.save();

    logger.info(`Order ${order.orderNumber} marked as PAID`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: markOrderPaid - ${error.message}`);
    throw error;
  }
};

// ── Cancel Order ──────────────────────────────────────────────
exports.cancelOrder = async (id) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error('Order not found.');
    if (['completed', 'cancelled'].includes(order.status)) {
      throw new Error(`Order is already ${order.status}.`);
    }

    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', changedAt: new Date() });
    await order.save();

    logger.info(`Order ${order.orderNumber} cancelled`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: cancelOrder - ${error.message}`);
    throw error;
  }
};

// ── Get Next Order Number ──────────────────────────────────────
exports.getNextOrderNumber = async (orderType) => {
  try {
    const nextNumber = await Order.previewNextOrderNumber(orderType);
    return nextNumber;
  } catch (error) {
    logger.error(`Order Service Error: getNextOrderNumber - ${error.message}`);
    throw error;
  }
};
