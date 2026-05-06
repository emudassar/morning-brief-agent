// telegram.js — Telegram bot (polling), commands, outbound messages, polling recovery, and status export
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

const telegramStatus = {
  moduleLoadedAt: new Date().toISOString(),
  pollingStartedAt: null,
  lastPollingRestartAt: null,
  restartAttempts: 0,
  lastPollingErrorAt: null,
  lastPollingErrorMessage: null,
  restartInProgress: false,
  restartBackoffMs: 3000,
};

function getTelegramBotStatus() {
  let isPolling = false;
  try {
    isPolling = typeof bot.isPolling === "function" ? bot.isPolling() : false;
  } catch {
    isPolling = false;
  }

  return {
    moduleLoadedAt: telegramStatus.moduleLoadedAt,
    pollingStartedAt: telegramStatus.pollingStartedAt,
    lastPollingRestartAt: telegramStatus.lastPollingRestartAt,
    restartAttempts: telegramStatus.restartAttempts,
    lastPollingErrorAt: telegramStatus.lastPollingErrorAt,
    lastPollingErrorMessage: telegramStatus.lastPollingErrorMessage,
    isPolling,
    restartInProgress: telegramStatus.restartInProgress,
    restartBackoffMs: telegramStatus.restartBackoffMs,
  };
}

let pollingRestartTimer = null;

async function restartPolling(reason) {
  if (telegramStatus.restartInProgress) {
    console.warn("[telegram] restartPolling skipped — already running");
    return;
  }

  telegramStatus.restartInProgress = true;
  telegramStatus.restartAttempts += 1;
  const delay = telegramStatus.restartBackoffMs;

  console.error(
    `[telegram] Polling restart scheduled in ${delay}ms (attempt ${telegramStatus.restartAttempts}) — ${reason}`
  );

  await new Promise((r) => setTimeout(r, delay));

  try {
    console.log("[telegram] stopPolling() …");
    await bot.stopPolling({ cancel: true });
  } catch (err) {
    console.warn("[telegram] stopPolling warning:", err.message || err);
  }

  await new Promise((r) => setTimeout(r, 2000));

  try {
    console.log("[telegram] startPolling() …");
    await bot.startPolling();
    telegramStatus.pollingStartedAt = new Date().toISOString();
    telegramStatus.lastPollingRestartAt = telegramStatus.pollingStartedAt;
    telegramStatus.restartBackoffMs = 3000;
    telegramStatus.restartAttempts = 0;
    console.log("[telegram] Polling restarted successfully");
  } catch (err) {
    telegramStatus.lastPollingErrorAt = new Date().toISOString();
    telegramStatus.lastPollingErrorMessage = err.message || String(err);
    console.error("[telegram] startPolling failed:", telegramStatus.lastPollingErrorMessage);
    telegramStatus.restartBackoffMs = Math.min(telegramStatus.restartBackoffMs * 2, 120000);
    telegramStatus.restartInProgress = false;
    restartPolling(`retry after failure: ${telegramStatus.lastPollingErrorMessage}`);
    return;
  }

  telegramStatus.restartInProgress = false;
}

function schedulePollingRestart(reason) {
  telegramStatus.lastPollingErrorAt = new Date().toISOString();
  telegramStatus.lastPollingErrorMessage = reason;

  if (pollingRestartTimer) {
    clearTimeout(pollingRestartTimer);
  }

  pollingRestartTimer = setTimeout(() => {
    pollingRestartTimer = null;
    restartPolling(reason).catch((err) => {
      console.error("[telegram] restartPolling async error:", err.message || err);
      telegramStatus.restartInProgress = false;
    });
  }, 1500);
}

bot.on("polling_error", (err) => {
  const msg = err.message || String(err);
  console.error("[telegram] polling_error:", msg);
  console.error(
    "  Hint: IPv6/firewall — NODE_OPTIONS=--dns-result-order=ipv4first or check outbound HTTPS to api.telegram.org"
  );
  schedulePollingRestart(msg);
});

bot.on("error", (err) => {
  console.error("[telegram] bot error:", err.message || err);
});

telegramStatus.pollingStartedAt = new Date().toISOString();
console.log(`[telegram] Bot polling active — startedAt=${telegramStatus.pollingStartedAt}`);

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

bot.onText(/^\/briefing(?:@\w+)?\s*$/i, async (msg) => {
  const chatId = msg.chat.id;
  const rawText = msg.text || "";
  console.log(`[telegram] /briefing received chatId=${chatId} text=${JSON.stringify(rawText)}`);

  try {
    const linkedChatId = String(chatId);
    const user = await User.findOne({ telegramChatId: linkedChatId });
    if (!user) {
      console.warn(`[telegram] /briefing no user for telegramChatId=${linkedChatId}`);
      return bot.sendMessage(chatId, "Connect first: /start your@email.com");
    }

    console.log(`[telegram] /briefing executing runBriefingJob for ${user.email} (_id=${user._id})`);
    await bot.sendMessage(chatId, "Generating your briefing...");
    const { runBriefingJob } = require("../jobs/briefingJob");
    try {
      runBriefingJob(user._id);
    } catch (jobErr) {
      console.error(`[telegram] /briefing runBriefingJob threw for ${user.email}:`, jobErr.message);
      await bot.sendMessage(chatId, "Could not start briefing generation. Try again shortly.");
    }
  } catch (err) {
    console.error("[telegram] /briefing handler error:", err.message);
    try {
      await bot.sendMessage(chatId, "Something went wrong. Please try again.");
    } catch (sendErr) {
      console.error("[telegram] /briefing failed to send error reply:", sendErr.message);
    }
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

module.exports = { bot, sendTelegramMessage, getTelegramBotStatus };
