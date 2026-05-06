const User = require("../models/User");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getTrialDaysRemaining(user) {
  if (!user || !user.subscription || user.subscription.plan !== "trial") {
    return -1;
  }

  const trialEndsAt = user.subscription.trialEndsAt ? new Date(user.subscription.trialEndsAt).getTime() : 0;
  const diff = trialEndsAt - Date.now();

  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / MS_PER_DAY);
}

async function requireActiveSubscription(req, res, next) {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "unauthorized",
        message: "User not authenticated.",
      });
    }

    const subscription = user.subscription || {};
    const now = Date.now();

    if (subscription.plan === "trial") {
      const trialEndsAt = subscription.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : 0;

      if (now <= trialEndsAt) {
        return next();
      }

      user.subscription = {
        ...subscription,
        plan: "free",
        status: "expired",
      };

      if (user._id) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              "subscription.plan": "free",
              "subscription.status": "expired",
            },
          }
        );
      }

      return res.status(403).json({
        error: "trial_expired",
        message: "Your free trial has ended. Please upgrade to continue.",
        upgradeUrl: "/pricing",
      });
    }

    if (subscription.plan === "monthly" || subscription.plan === "yearly") {
      const currentPeriodEnd = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).getTime()
        : 0;

      if (subscription.status === "active" && now <= currentPeriodEnd) {
        return next();
      }

      return res.status(403).json({
        error: "subscription_inactive",
        message: "Your subscription is inactive. Please renew.",
        upgradeUrl: "/pricing",
      });
    }

    if (subscription.plan === "free") {
      req.planLimits = {
        briefingsPerWeek: 3,
        modulesAllowed: ["weather", "news"],
        historyDays: 0,
      };
      return next();
    }

    return res.status(403).json({
      error: "subscription_inactive",
      message: "Your subscription is inactive. Please renew.",
      upgradeUrl: "/pricing",
    });
  } catch (error) {
    return res.status(500).json({
      error: "server_error",
      message: "An unexpected error occurred while checking subscription status.",
    });
  }
}

module.exports = { requireActiveSubscription, getTrialDaysRemaining };
