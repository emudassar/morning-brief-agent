// userController.js — authenticated user profile and preferences
const User = require("../models/User");
const Briefing = require("../models/Briefing");

exports.getMe = (req, res) => {
  res.json(req.user);
};

exports.updatePreferences = async (req, res) => {
  try {
    const b = req.body;
    const patch = {};
    if (b.modules !== undefined) patch.modules = b.modules;
    if (b.briefingTime !== undefined) patch.briefingTime = b.briefingTime;
    if (b.timezone !== undefined) patch.timezone = b.timezone;
    if (b.city !== undefined) patch.city = b.city;
    if (b.country !== undefined) patch.country = b.country;

    const updated = await User.findByIdAndUpdate(req.user._id, patch, {
      new: true,
      runValidators: true,
    }).select("-passwordHash");
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveTelegramId = async (req, res) => {
  try {
    const { telegramChatId } = req.body;
    if (!telegramChatId) return res.status(400).json({ error: "telegramChatId required" });
    const updated = await User.findByIdAndUpdate(req.user._id, { telegramChatId }, { new: true }).select(
      "-passwordHash"
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTimezone = async (req, res) => {
  try {
    const { timezone } = req.body;
    const updated = await User.findByIdAndUpdate(req.user._id, { timezone }, { new: true }).select("-passwordHash");
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleActive = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.isActive = !user.isActive;
    await user.save();
    res.json({ isActive: user.isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    await Briefing.deleteMany({ userId: req.user._id });
    await User.findByIdAndDelete(req.user._id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
