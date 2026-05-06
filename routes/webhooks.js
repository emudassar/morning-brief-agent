const express = require("express");
const { handleLemonSqueezyWebhook } = require("../controllers/webhookController");

const router = express.Router();

router.post(
  "/webhooks/lemonsqueezy",
  express.raw({ type: "application/json" }),
  handleLemonSqueezyWebhook
);

module.exports = router;
