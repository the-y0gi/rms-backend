const Order = require('../models/order.model');
const logger = require('../../../shared/utils/logger');

// ── Create Order ──────────────────────────────────────────────
exports.createOrder = async (orderData) => {
  try {
    const orderNumber = await Order.generateOrderNumber(
      orderData.orderType,
      orderData.orderTiming === 'later' ? orderData.scheduledAt : null
    );

    // If pay-later → paymentStatus = unpaid, no payments array needed
    const paymentStatus =
      orderData.paymentTiming === 'pay-later' ? 'unpaid' : 'paid';

    let dueAt = orderData.dueAt;
    if (!dueAt) {
      if (orderData.orderTiming === 'later' && orderData.scheduledAt) {
        dueAt = new Date(orderData.scheduledAt);
      } else {
        dueAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins default
      }
    }

    const order = new Order({
      ...orderData,
      customer: orderData.customer && orderData.customer.name && orderData.customer.name.trim()
        ? orderData.customer
        : { name: 'No Name', phone: '', email: '' },
      orderNumber,
      paymentStatus,
      dueAt,
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

    // Date filter: single date or range
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    } else if (filters.date) {
      const start = new Date(filters.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filters.date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(query)
      .select('orderNumber customer subtotal total orderType orderSource paymentStatus status createdAt items')
      .sort({ createdAt: -1 })
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

    if (payments && payments.length > 0) {
      order.payments = [...(order.payments || []), ...payments];
    }
    
    const paymentsTotal = order.payments ? order.payments.reduce((sum, p) => sum + p.amount, 0) : 0;
    if (paymentsTotal >= order.total - 0.01) {
      order.paymentStatus = 'paid';
      order.paymentTiming = 'pay-now';
    } else {
      order.paymentStatus = 'unpaid'; // still partially unpaid
    }
    
    await order.save();

    logger.info(`Order ${order.orderNumber} payments updated. Total paid: ${paymentsTotal}`);
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

// ── Update Order Due Time ─────────────────────────────────────
exports.updateOrderDueTime = async (id, dueAt) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error('Order not found.');

    order.dueAt = new Date(dueAt);
    await order.save();

    logger.info(`Order ${order.orderNumber} due time updated to ${dueAt}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderDueTime - ${error.message}`);
    throw error;
  }
};

// ── Update Order Items ─────────────────────────────────────────
exports.updateOrderItems = async (id, updateData) => {
  try {
    const order = await Order.findById(id);
    if (!order) throw new Error('Order not found.');

    if (updateData.items) {
      order.items = updateData.items;
    }
    if (updateData.subtotal !== undefined) order.subtotal = updateData.subtotal;
    if (updateData.tax !== undefined) order.tax = updateData.tax;
    if (updateData.discount !== undefined) order.discount = updateData.discount;
    if (updateData.total !== undefined) {
      order.total = updateData.total;
      
      // Recalculate payment status based on total and paid amounts
      const paymentsTotal = order.payments ? order.payments.reduce((sum, p) => sum + p.amount, 0) : 0;
      if (paymentsTotal >= updateData.total - 0.01) {
        order.paymentStatus = 'paid';
      } else {
        order.paymentStatus = 'unpaid';
      }
    }
    if (updateData.notes !== undefined) order.notes = updateData.notes;

    await order.save();
    logger.info(`Order ${order.orderNumber} items updated. Payment status: ${order.paymentStatus}`);
    return order;
  } catch (error) {
    logger.error(`Order Service Error: updateOrderItems - ${error.message}`);
    throw error;
  }
};
