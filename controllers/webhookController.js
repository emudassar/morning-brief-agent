const crypto = require("crypto");
const User = require("../models/User");

function getPlanDetailsFromVariant(variantName = "") {
  const name = String(variantName).toLowerCase();
  if (name.includes("yearly")) {
    return {
      plan: "yearly",
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }
  return {
    plan: "monthly",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

function verifySignature(rawBody, signatureHeader) {
  if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET || !signatureHeader) return false;

  const digest = crypto
    .createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expected = Buffer.from(digest, "utf8");
  const provided = Buffer.from(signatureHeader, "utf8");

  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

async function handleLemonSqueezyWebhook(req, res) {
  try {
    const rawBody = req.body;
    const signature = req.get("X-Signature");

    if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, signature)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    const eventName = payload?.meta?.event_name;
    const data = payload?.data || {};
    const attributes = data?.attributes || {};

    if (eventName === "order_created") {
      const customerEmail = attributes.user_email;
      const orderId = data.id;
      const variantName = attributes?.first_order_item?.variant_name || "";
      const { plan, currentPeriodEnd } = getPlanDetailsFromVariant(variantName);
      const now = new Date();

      const user = await User.findOne({ email: customerEmail });
      if (user) {
        user.subscription = {
          ...user.subscription,
          plan,
          status: "active",
          lemonSqueezyOrderId: String(orderId),
          currentPeriodStart: now,
          currentPeriodEnd,
        };
        await user.save();
        console.log(`[webhook] order_created processed for ${customerEmail}`);
      }

      return res.status(200).json({ received: true });
    }

    if (eventName === "subscription_created") {
      const subscriptionId = data.id;
      const customerId = attributes.customer_id;
      const customerEmail = attributes.user_email;
      const variantName = attributes.variant_name || "";
      const { plan, currentPeriodEnd } = getPlanDetailsFromVariant(variantName);
      const now = new Date();

      const user = await User.findOne({ email: customerEmail });
      if (user) {
        user.subscription = {
          ...user.subscription,
          lemonSqueezyCustomerId: customerId ? String(customerId) : null,
          lemonSqueezySubscriptionId: subscriptionId ? String(subscriptionId) : null,
          plan,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd,
        };
        await user.save();
        console.log(`[webhook] subscription_created processed for ${customerEmail}`);
      }

      return res.status(200).json({ received: true });
    }

    if (eventName === "subscription_renewed") {
      const subscriptionId = data.id;
      const now = new Date();
      const user = await User.findOne({
        "subscription.lemonSqueezySubscriptionId": String(subscriptionId),
      });

      if (user) {
        const isYearly = user.subscription?.plan === "yearly";
        user.subscription = {
          ...user.subscription,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(
            Date.now() + (isYearly ? 365 : 30) * 24 * 60 * 60 * 1000
          ),
          status: "active",
        };
        await user.save();
        console.log(`[webhook] subscription_renewed processed for ${user.email}`);
      }

      return res.status(200).json({ received: true });
    }

    if (eventName === "subscription_cancelled") {
      const subscriptionId = data.id;
      const user = await User.findOne({
        "subscription.lemonSqueezySubscriptionId": String(subscriptionId),
      });

      if (user) {
        user.subscription = {
          ...user.subscription,
          cancelAtPeriodEnd: true,
        };
        await user.save();
        console.log(`[webhook] subscription_cancelled processed for ${user.email}`);
      }

      return res.status(200).json({ received: true });
    }

    if (eventName === "subscription_expired") {
      const subscriptionId = data.id;
      const user = await User.findOne({
        "subscription.lemonSqueezySubscriptionId": String(subscriptionId),
      });

      if (user) {
        user.subscription = {
          ...user.subscription,
          plan: "free",
          status: "expired",
        };
        await user.save();
        console.log(`[webhook] subscription_expired processed for ${user.email}`);
      }

      return res.status(200).json({ received: true });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { handleLemonSqueezyWebhook };
