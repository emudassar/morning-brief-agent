// user.js — authenticated user APIs
const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth");
const {
  getMe,
  updatePreferences,
  saveTelegramId,
  updateTimezone,
  toggleActive,
  deleteAccount,
  getSubscriptionStatus,
} = require("../controllers/userController");

router.get("/me", protect, getMe);
router.put("/preferences", protect, updatePreferences);
router.put("/telegram", protect, saveTelegramId);
router.put("/timezone", protect, updateTimezone);
router.put("/toggle-active", protect, toggleActive);
router.delete("/me", protect, deleteAccount);
router.get("/subscription", protect, getSubscriptionStatus);

module.exports = router;
