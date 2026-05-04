// Briefing.js — history of generated briefings per user
const mongoose = require("mongoose");

const briefingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sent", "failed", "pending"],
      default: "pending",
    },
    errorMessage: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Briefing", briefingSchema);
