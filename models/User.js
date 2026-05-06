// User.js — account, Telegram link, briefing preferences, and OAuth placeholders
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    telegramChatId: { type: String, default: null },
    telegramUsername: { type: String, default: null },
    briefingTime: { type: String, default: "08:00" },
    timezone: { type: String, default: "UTC" },
    city: { type: String, required: true },
    country: { type: String, default: "us" },
    isActive: { type: Boolean, default: true },
    modules: {
      weather: { type: Boolean, default: true },
      news: { type: Boolean, default: true },
      calendar: { type: Boolean, default: false },
      crypto: { type: Boolean, default: false },
      quote: { type: Boolean, default: true },
    },
    googleOAuth: {
      accessToken: { type: String, default: null },
      refreshToken: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
    subscription: {
      plan: { type: String, enum: ["free", "trial", "monthly", "yearly"], default: "trial" },
      status: { type: String, enum: ["active", "expired", "cancelled", "past_due"], default: "active" },
      trialStartedAt: { type: Date, default: Date.now },
      trialEndsAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      currentPeriodStart: { type: Date, default: null },
      currentPeriodEnd: { type: Date, default: null },
      lemonSqueezyCustomerId: { type: String, default: null },
      lemonSqueezySubscriptionId: { type: String, default: null },
      lemonSqueezyOrderId: { type: String, default: null },
      cancelAtPeriodEnd: { type: Boolean, default: false },
    },
    lastBriefingAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);
