// telegram.js — Telegram bot (polling), commands, and outbound messages
const https = require("https");
const TelegramBot = require("node-telegram-bot-api");
const User = require("../models/User");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is missing — add it to server/.env");
  process.exit(1);
}

/** Prefer IPv4 — fixes many Windows/network setups where IPv6 to api.telegram.org resets (ECONNRESET). */
const telegramHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  family: 4,
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    params: { timeout: 50 },
  },
  request: {
    agent: telegramHttpsAgent,
    timeout: 70000,
  },
});

bot.on("polling_error", (err) => {
  console.error(
    "[telegram] polling_error — bot cannot reach Telegram (no /start replies until fixed):",
    err.message || err
  );
  console.error(
    "  Try: mobile hotspot/VPN, allow Node in firewall, or run: $env:NODE_OPTIONS='--dns-result-order=ipv4first'; npm run dev"
  );
});

console.log("Polling...");

/** Telegram sends /start, /start payload, or /start@BotUsername payload — strip command before reading email */
function parseStartEmail(text) {
  const t = (text || "").trim();
  const m = t.match(/^\/start(?:@[\w]+)?\s*(.*)$/is);
  return (m && m[1] ? m[1] : "").trim().toLowerCase();
}

bot.onText(/^\/start(?:@[\w]+)?(?:\s|$)/i, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const email = parseStartEmail(msg.text || "");
    console.log(`[telegram] /start text="${msg.text}" parsedEmail="${email}"`);

    if (!email) {
      return bot.sendMessage(
        chatId,
        "Welcome! To connect your account, send: /start your@email.com"
      );
    }

    const user = await User.findOne({ email });
    if (!user) {
      return bot.sendMessage(
        chatId,
        `No account found for "${email}". Register on the web app with this exact email first, then try again.`
      );
    }

    await User.findByIdAndUpdate(user._id, {
      telegramChatId: String(chatId),
      telegramUsername: msg.from?.username || null,
    });

    return bot.sendMessage(
      chatId,
      `Connected! Briefing arrives at ${user.briefingTime} (${user.timezone}). Type /briefing now!`
    );
  } catch (err) {
    console.error("Telegram /start error:", err.message);
    return bot.sendMessage(chatId, "Something went wrong. Please try again.");
  }
});

bot.onText(/^\/briefing(?:@\w+)?$/i, async (msg) => {
  try {
    const chatId = String(msg.chat.id);
    const user = await User.findOne({ telegramChatId: chatId });
    if (!user) {
      return bot.sendMessage(msg.chat.id, "Connect first: /start your@email.com");
    }

    await bot.sendMessage(msg.chat.id, "Generating your briefing...");
    const { runBriefingJob } = require("../jobs/briefingJob");
    runBriefingJob(user._id);
  } catch (err) {
    console.error("Telegram /briefing error:", err.message);
    bot.sendMessage(msg.chat.id, "Something went wrong. Please try again.");
  }
});

bot.onText(/^\/pause(?:@\w+)?$/i, async (msg) => {
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: String(msg.chat.id) },
      { isActive: false },
      { new: true }
    );
    if (!user) return bot.sendMessage(msg.chat.id, "Account not connected.");
    bot.sendMessage(msg.chat.id, "Briefings paused. Send /resume to restart.");
  } catch (err) {
    console.error("Telegram /pause error:", err.message);
    bot.sendMessage(msg.chat.id, "Something went wrong. Please try again.");
  }
});

bot.onText(/^\/resume(?:@\w+)?$/i, async (msg) => {
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: String(msg.chat.id) },
      { isActive: true },
      { new: true }
    );
    if (!user) return bot.sendMessage(msg.chat.id, "Account not connected.");
    bot.sendMessage(msg.chat.id, "Briefings resumed.");
  } catch (err) {
    console.error("Telegram /resume error:", err.message);
    bot.sendMessage(msg.chat.id, "Something went wrong. Please try again.");
  }
});

bot.onText(/^\/help(?:@\w+)?$/i, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "*Commands*\n\n" +
      "/start email — Connect your web account\n" +
      "/briefing — Generate a briefing now\n" +
      "/pause — Pause scheduled briefings\n" +
      "/resume — Resume scheduled briefings\n" +
      "/help — Show this list",
    { parse_mode: "Markdown" }
  );
});

const sendTelegramMessage = async (chatId, text) =>
  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });

module.exports = { bot, sendTelegramMessage };
