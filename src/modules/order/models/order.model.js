const mongoose = require("mongoose");

// ── Sub-schemas ───────────────────────────────────────────────
const selectedModifierSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    groupName: { type: String, required: true },
    optionId: { type: String, required: true },
    optionName: { type: String, required: true },
    price: { type: Number, default: 0 },
    isRoot: { type: Boolean, default: true },
  },
  { _id: false },
);

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: String, required: true },
    name: { type: String, required: true },
    image: { type: String, default: "" },
    basePrice: { type: Number, required: true },
    selectedModifiers: { type: [selectedModifierSchema], default: [] },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const paymentEntrySchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ["cash", "card", "credit", "debit"],
      required: true,
    },
    amount: { type: Number, required: true },
    personName: { type: String, default: "" }, // for split between people
    cashGiven: { type: Number, default: 0 }, // for cash
    changeGiven: { type: Number, default: 0 }, // for cash
  },
  { _id: false },
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  { _id: false },
);

// ── Order Counter helper (daily sequential) ───────────────────
const OrderCounterSchema = new mongoose.Schema({
  _id: { type: String }, // "YYYY-MM-DD"
  count: { type: Number, default: 0 },
});
const OrderCounter = mongoose.model("OrderCounter", OrderCounterSchema);

// ── Main Order Schema ─────────────────────────────────────────
const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, index: true },
    orderType: {
      type: String,
      enum: ["takeout", "drive-through", "dine-in"],
      required: true,
    },
    orderSource: {
      type: String,
      enum: ["pos", "online"],
      default: "pos",
    },

    // Items
    items: { type: [orderItemSchema], required: true },

    // Financials
    subtotal: { type: Number, required: true },
    taxRate: { type: Number, default: 0.05 }, // 5% — admin configurable later
    tax: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ["none", "promo", "percentage", "flat"],
      default: "none",
    },
    promoCode: { type: String, default: "" },
    total: { type: Number, required: true },

    // Payment
    paymentTiming: {
      type: String,
      enum: ["pay-now", "pay-later"],
      default: "pay-now",
    },
    paymentType: {
      type: String,
      enum: ["one-time", "split"],
      default: "one-time",
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid"],
      default: "paid",
    },
    payments: { type: [paymentEntrySchema], default: [] },

    // Scheduling
    orderTiming: {
      type: String,
      enum: ["now", "later"],
      default: "now",
    },
    scheduledAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },

    // Optional customer
    customer: { type: customerSchema, default: null },

    // Notes
    notes: { type: String, default: "" },

    // Status flow: pending → preparing → ready → completed
    status: {
      type: String,
      enum: ["pending", "preparing", "ready", "completed", "cancelled"],
      default: "pending",
    },
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  {
    timestamps: true,
  },
);

// ── Static: Generate order number ─────────────────────────────
const TYPE_PREFIX = {
  takeout: "TO",
  "drive-through": "DT",
  "dine-in": "DN",
};

orderSchema.statics.generateOrderNumber = async function (
  orderType,
  scheduledAt,
) {
  let targetDate;
  if (scheduledAt) {
    targetDate = new Date(scheduledAt);
  } else {
    targetDate = new Date();
  }
  const localDate = new Date(
    targetDate.getTime() - targetDate.getTimezoneOffset() * 60000,
  );
  const today = localDate.toISOString().slice(0, 10).replace(/-/g, ""); // "20260626"
  const prefix = TYPE_PREFIX[orderType] || "TO";

  const counter = await OrderCounter.findByIdAndUpdate(
    today,
    { $inc: { count: 1 } },
    { upsert: true, new: true },
  );

  const seq = String(counter.count).padStart(3, "0");
  return `#${prefix}-${today}-${seq}`;
};

orderSchema.statics.previewNextOrderNumber = async function (orderType) {
  const d = new Date();
  const localDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  const today = localDate.toISOString().slice(0, 10).replace(/-/g, ""); // "20260626"
  const prefix = TYPE_PREFIX[orderType] || "TO";

  const counter = await OrderCounter.findById(today);
  const nextCount = (counter ? counter.count : 0) + 1;
  const seq = String(nextCount).padStart(3, "0");
  return `#${prefix}-${today}-${seq}`;
};

orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
