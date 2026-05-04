// briefingController.js — briefing history and manual send
const Briefing = require("../models/Briefing");
const { runBriefingJob } = require("../jobs/briefingJob");

exports.getHistory = async (req, res) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, raw)) : 10;
    const briefings = await Briefing.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(limit);
    res.json(briefings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLatest = async (req, res) => {
  try {
    const briefing = await Briefing.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(briefing || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.sendNow = async (req, res) => {
  try {
    if (!req.user.telegramChatId) {
      return res.status(400).json({ error: "Telegram not connected" });
    }
    runBriefingJob(req.user._id);
    res.json({ success: true, message: "Check Telegram in ~10 seconds" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
