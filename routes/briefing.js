// briefing.js — briefing history and send-now
const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth");
const { getHistory, getLatest, sendNow } = require("../controllers/briefingController");

router.get("/history", protect, getHistory);
router.get("/latest", protect, getLatest);
router.post("/send-now", protect, sendNow);

module.exports = router;
