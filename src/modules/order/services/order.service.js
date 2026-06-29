const Order = require('../models/order.model');
const Product = require('../../menu/models/product.model');
const Category = require('../../menu/models/category.model');
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

// ── Get Sales Summary Aggregation ─────────────────────────────
exports.getSalesSummary = async (filters = {}) => {
  try {
    const query = {};
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

    const orders = await Order.find(query).lean();

    // Fetch products to build category lookup map
    const productCategoryMap = {};
    try {
      const products = await Product.find().populate('categoryId').lean();
      products.forEach(p => {
        const prodId = p._id ? p._id.toString() : '';
        const catName = p.categoryId && typeof p.categoryId === 'object' ? p.categoryId.name : '';
        if (prodId && catName) {
          productCategoryMap[prodId] = catName;
        }
      });
    } catch (err) {
      logger.warn(`Could not build product category lookup: ${err.message}`);
    }

    // 1. Completed & Cancelled Orders
    let completedCount = 0;
    let completedTotal = 0;
    let cancelledCount = 0;
    let cancelledTotal = 0;

    // Financial sums for completed/valid orders
    let grossSubtotal = 0;
    let grossTax = 0;
    let grossDiscount = 0;
    let grandTotal = 0;

    // Categories map
    const categorySales = {};

    // Order Types
    let takeoutTotal = 0;
    let dineInTotal = 0;
    let driveThroughTotal = 0;

    // Channels
    let onlineTotal = 0;
    let posTotal = 0;

    // Payment methods
    let cashTotal = 0;
    let cardTotal = 0;

    orders.forEach(order => {
      if (order.status === 'cancelled') {
        cancelledCount += 1;
        cancelledTotal += order.total || 0;
      } else {
        completedCount += 1;
        completedTotal += order.total || 0;

        grossSubtotal += order.subtotal || 0;
        grossTax += order.tax || 0;
        grossDiscount += order.discount || 0;
        grandTotal += order.total || 0;

        // Order types
        if (order.orderType === 'takeout') takeoutTotal += order.total;
        else if (order.orderType === 'dine-in') dineInTotal += order.total;
        else if (order.orderType === 'drive-through') driveThroughTotal += order.total;

        // Channel
        if (order.orderSource === 'online') onlineTotal += order.total;
        else posTotal += order.total;

        // Payments
        if (order.paymentStatus === 'paid') {
          if (order.paymentType === 'split' && order.payments && order.payments.length > 0) {
            order.payments.forEach(p => {
              if (p.method === 'cash') cashTotal += p.amount;
              else cardTotal += p.amount;
            });
          } else {
            cashTotal += order.total;
          }
        }

        // Category breakdown from items
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(item => {
            const itemProdId = item.menuItemId ? item.menuItemId.toString() : '';
            const catName = item.categoryName || item.category || productCategoryMap[itemProdId] || 'Open Item';
            categorySales[catName] = (categorySales[catName] || 0) + (item.totalPrice || (item.basePrice * item.quantity));
          });
        }
      }
    });

    return {
      dateRange: { startDate: filters.startDate, endDate: filters.endDate || filters.date },
      completedOrders: { count: completedCount, totalAmount: completedTotal },
      cancelledOrders: { count: cancelledCount, totalAmount: cancelledTotal },
      refundOrders: { count: 0, totalAmount: 0 },
      financials: {
        allCategoryTotal: grossSubtotal,
        subTotal: grossSubtotal,
        deliveryCharges: 0,
        debitCardCharges: 0,
        discount: grossDiscount,
        tax: grossTax,
        grandTotal: grandTotal,
        tips: 0,
        finalAmount: grandTotal
      },
      categorySales: Object.entries(categorySales).map(([name, total]) => ({ name, total })),
      discountSummary: { percentageDiscount: grossDiscount, total: grossDiscount },
      taxSummary: { pst: 0, gst: grossTax, hst: 0, total: grossTax },
      salesReceived: {
        accountPay: 0,
        cash: cashTotal,
        creditCardSales: 0,
        debitCardSales: cardTotal,
        grandTotal: grandTotal,
        tips: 0,
        finalAmount: grandTotal
      },
      cardTypeReceived: {
        interac: { total: cardTotal, tips: 0, final: cardTotal },
        mastercard: { total: 0, tips: 0, final: 0 },
        visa: { total: 0, tips: 0, final: 0 },
        total: { total: cardTotal, tips: 0, final: cardTotal }
      },
      orderTypeSummary: {
        takeout: takeoutTotal,
        dineIn: dineInTotal,
        driveThrough: driveThroughTotal,
        total: grandTotal
      },
      channelSummary: {
        online: onlineTotal,
        pos: posTotal
      },
      expense: (await (async () => {
        try {
          const Expense = require('../../expense/models/expense.model');
          const expQuery = {};
          if (filters.date) {
            const dateStr = String(filters.date).split('T')[0];
            const parts = dateStr.split('-');
            if (parts.length === 3) {
              const start = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0));
              const end = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999));
              expQuery.expenseDate = { $gte: start, $lte: end };
            }
          }
          const expenses = await Expense.find(expQuery).lean();
          const empMap = {};
          expenses.forEach(e => {
            const emp = e.expenseType === 'store' ? 'Store Expense' : (e.employeeName || 'Manager');
            if (!empMap[emp]) {
              empMap[emp] = { employee: emp, pst: 0, gst: 0, hst: 0, total: 0 };
            }
            empMap[emp].pst += e.pst || 0;
            empMap[emp].gst += e.gst || 0;
            empMap[emp].hst += e.hst || 0;
            empMap[emp].total += e.amount || 0;
          });
          return Object.values(empMap);
        } catch (err) {
          return [];
        }
      })()),
      shortageOverage: { cash: 0, card: 0, accountPay: 0 },
      moneyToBeCollected: { cash: cashTotal, card: cardTotal, accountPay: 0 },
      driverReport: []
    };
  } catch (error) {
    logger.error(`Order Service Error: getSalesSummary - ${error.message}`);
    throw error;
  }
};

